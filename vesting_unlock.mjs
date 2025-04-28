import {
  deserializeAddress,
  deserializeDatum,
  unixTimeToEnclosingSlot,
  SLOT_CONFIG_NETWORK,
} from "@meshsdk/core";
 
import {
  getTxBuilder,
  beneficiary_wallet,
  scriptAddr,
  scriptCbor,
} from "./common/common.mjs";
import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Check if BLOCKFROST_API is available
const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API;
if (!BLOCKFROST_API_KEY) {
  console.error("Error: BLOCKFROST_API environment variable is not set.");
  process.exit(1);
}

// Function to fetch UTXOs directly from Blockfrost API
async function fetchUtxosDirectly(address) {
  console.log(`Fetching UTXOs for address: ${address}`);
  
  const url = `https://cardano-preview.blockfrost.io/api/v0/addresses/${address}/utxos`;
  
  try {
    const response = await fetch(url, {
      headers: {
        "project_id": BLOCKFROST_API_KEY
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching UTXOs: Status ${response.status}, Response: ${errorText}`);
      
      // If address not found, return empty array instead of throwing
      if (response.status === 404) {
        console.warn(`Address ${address} not found or has no UTXOs. This might be normal for a new address.`);
        return [];
      }
      
      throw new Error(`Blockfrost API error: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    console.log(`Found ${data.length} UTXOs for address ${address}`);
    
    // Format the data to match what MeshSDK expects
    return data.map(utxo => ({
      input: {
        outputIndex: utxo.output_index,
        txHash: utxo.tx_hash
      },
      output: {
        address: address,
        amount: utxo.amount.map(asset => ({
          unit: asset.unit,
          quantity: asset.quantity
        }))
      }
    }));
  } catch (error) {
    console.error("Error in fetchUtxosDirectly:", error);
    throw error;
  }
}

// Function to fetch a specific UTXO by transaction hash
async function getUtxoByTxHash(txHash) {
  console.log(`Looking for UTXO from transaction: ${txHash}`);
  
  const url = `https://cardano-preview.blockfrost.io/api/v0/txs/${txHash}/utxos`;
  
  try {
    const response = await fetch(url, {
      headers: {
        "project_id": BLOCKFROST_API_KEY
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching transaction: Status ${response.status}, Response: ${errorText}`);
      throw new Error(`Blockfrost API error: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.outputs || data.outputs.length === 0) {
      throw new Error("UTxO not found");
    }
    
    console.log(`Transaction found with ${data.outputs.length} outputs`);
    
    // Print all available outputs
    console.log("Available outputs:");
    data.outputs.forEach((output, index) => {
      console.log(`Output ${index}: Address ${output.address}`);
    });
    
    // Find the UTXO at the script address
    const scriptUtxo = data.outputs.find(output => output.address === scriptAddr);
    
    if (!scriptUtxo) {
      console.error(`No UTXO found at script address: ${scriptAddr}`);
      console.error(`Script address: ${scriptAddr}`);
      console.error(`Transaction outputs were sent to: ${data.outputs.map(o => o.address).join(', ')}`);
      throw new Error(`No UTXO found at script address: ${scriptAddr}`);
    }
    
    console.log(`Found UTXO at script address: ${scriptAddr}`);
    
    // Format the UTXO to match what MeshSDK expects
    return {
      input: {
        outputIndex: scriptUtxo.output_index,
        txHash: txHash
      },
      output: {
        address: scriptUtxo.address,
        amount: scriptUtxo.amount.map(asset => ({
          unit: asset.unit,
          quantity: asset.quantity
        })),
        plutusData: scriptUtxo.inline_datum || scriptUtxo.data_hash
      }
    };
  } catch (error) {
    console.error("Error in getUtxoByTxHash:", error);
    throw error;
  }
}

async function withdrawFundTx(vestingUtxo) {
  console.log("Building withdrawal transaction");
  
  const beneficiaryAddress = beneficiary_wallet.addresses.baseAddressBech32;
  console.log(`Beneficiary address: ${beneficiaryAddress}`);
  
  // Get UTXOs directly from Blockfrost
  const utxos = await fetchUtxosDirectly(beneficiaryAddress);
  
  if (utxos.length === 0) {
    console.error("No UTXOs found for beneficiary. The address might need funding for transaction fees.");
    throw new Error("No UTXOs available for transaction fees. Please fund the beneficiary address.");
  }
  
  // Get collateral - this is still using the wallet method as it's specific
  const collateral = await beneficiary_wallet.getCollateral();
  if (!collateral || collateral.length === 0) {
    throw new Error("No collateral available for transaction. Please set up collateral in the beneficiary wallet.");
  }
  
  const collateralInput = collateral[0].input;
  const collateralOutput = collateral[0].output;
 
  const { pubKeyHash: beneficiaryPubKeyHash } = deserializeAddress(beneficiaryAddress);
  console.log(`Beneficiary pubKeyHash: ${beneficiaryPubKeyHash}`);
 
  // Check if plutusData exists
  if (!vestingUtxo.output.plutusData) {
    console.error("No plutusData found in UTXO. This might not be a vesting contract UTXO.");
    throw new Error("Missing plutusData in UTXO");
  }
  
  const datum = deserializeDatum(vestingUtxo.output.plutusData);
  console.log("Datum deserialized:", datum);
 
  const invalidBefore =
    unixTimeToEnclosingSlot(
      Math.min(datum.fields[0].int, Date.now() - 19000),
      SLOT_CONFIG_NETWORK.preview
    ) + 1;
  
  console.log(`Setting invalidBefore to slot: ${invalidBefore}`);
  
  const txBuilder = getTxBuilder();
  try {
    await txBuilder
      .spendingPlutusScript("V3")
      .txIn(
        vestingUtxo.input.txHash,
        vestingUtxo.input.outputIndex,
        vestingUtxo.output.amount,
        scriptAddr
      )
      .spendingReferenceTxInInlineDatumPresent()
      .spendingReferenceTxInRedeemerValue("")
      .txInScript(scriptCbor)
      .txOut(beneficiaryAddress, [])
      .txInCollateral(
        collateralInput.txHash,
        collateralInput.outputIndex,
        collateralOutput.amount,
        collateralOutput.address
      )
      .invalidBefore(invalidBefore)
      .requiredSignerHash(beneficiaryPubKeyHash)
      .changeAddress(beneficiaryAddress)
      .selectUtxosFrom(utxos)
      .complete();
    
    return txBuilder.txHex;
  } catch (error) {
    console.error("Error building transaction:", error);
    throw error;
  }
}

async function main() {
  try {
    console.log("Starting vesting unlock process");
    
    // Make sure beneficiary wallet is properly loaded
    console.log(`Beneficiary wallet address: ${beneficiary_wallet.addresses.baseAddressBech32}`);
    
    const txHashFromDeposit = "10cad822a31824a140c8c01f23aadc9b1297f38b60ad28a3a1b01899001d1682";
   
    const utxo = await getUtxoByTxHash(txHashFromDeposit);
   
    const unsignedTx = await withdrawFundTx(utxo);
    console.log("Transaction built successfully, signing...");
   
    const signedTx = await beneficiary_wallet.signTx(unsignedTx);
    console.log("Transaction signed, submitting...");
   
    const txHash = await beneficiary_wallet.submitTx(signedTx);
    console.log("Transaction submitted successfully!");
    console.log("txHash:", txHash);
  } catch (error) {
    console.error("Error in main function:", error);
  }
}
 
main();