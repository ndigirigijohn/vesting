import { mConStr0 } from "@meshsdk/common";
import { deserializeAddress } from "@meshsdk/core";
import {
  getTxBuilder,
  owner_wallet,
  beneficiary_wallet,
  scriptAddr,
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
  const url = `https://cardano-preview.blockfrost.io/api/v0/addresses/${address}/utxos`;
  
  const response = await fetch(url, {
    headers: {
      "project_id": BLOCKFROST_API_KEY
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Blockfrost API error: ${response.status} ${errorText}`);
  }
  
  const data = await response.json();
  
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
}

async function depositFundTx(amount, lockUntilTimeStampMs) {
  // Get the base address from owner wallet
  const ownerAddress = owner_wallet.addresses.baseAddressBech32;
  
  // Fetch UTXOs directly using our custom function
  const utxos = await fetchUtxosDirectly(ownerAddress);
  
  console.log(`Found ${utxos.length} UTXOs for address ${ownerAddress}`);
  
  if (!utxos || utxos.length === 0) {
    throw new Error("No UTXOs available for transaction. Please fund the wallet first.");
  }
  
  const { pubKeyHash: ownerPubKeyHash } = deserializeAddress(ownerAddress);
  const { pubKeyHash: beneficiaryPubKeyHash } = deserializeAddress(
    beneficiary_wallet.addresses.baseAddressBech32
  );
  
  const txBuilder = getTxBuilder();
  try {
    await txBuilder
      .txOut(scriptAddr, amount)
      .txOutInlineDatumValue(
        mConStr0([lockUntilTimeStampMs, ownerPubKeyHash, beneficiaryPubKeyHash])
      )
      .changeAddress(ownerAddress)
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
    const assets = [
      {
        unit: "lovelace",
        quantity: "3000000",
      },
    ];
   
    const lockUntilTimeStamp = new Date();
    lockUntilTimeStamp.setMinutes(lockUntilTimeStamp.getMinutes() + 1);
    
    console.log(`Locking funds until: ${lockUntilTimeStamp.toISOString()}`);
   
    const unsignedTx = await depositFundTx(assets, lockUntilTimeStamp.getTime());
    
    console.log("Transaction built successfully, signing...");
    const signedTx = await owner_wallet.signTx(unsignedTx);
    
    console.log("Transaction signed, submitting...");
    const txHash = await owner_wallet.submitTx(signedTx);
   
    console.log("Transaction submitted successfully!");
    console.log("txHash:", txHash);
    console.log("Copy this txHash. You will need this hash in vesting_unlock.mjs");
  } catch (error) {
    console.error("Error in main function:", error);
  }
}
   
main();