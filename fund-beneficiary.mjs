import {
  getTxBuilder,
  owner_wallet,
  beneficiary_wallet
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
}

async function sendFunds(amount) {
  // Get addresses
  const ownerAddress = owner_wallet.addresses.baseAddressBech32;
  const beneficiaryAddress = beneficiary_wallet.addresses.baseAddressBech32;
  
  console.log(`Owner address: ${ownerAddress}`);
  console.log(`Beneficiary address: ${beneficiaryAddress}`);
  
  // Fetch UTXOs directly from Blockfrost
  const utxos = await fetchUtxosDirectly(ownerAddress);
  
  if (utxos.length === 0) {
    throw new Error("No UTXOs available in owner wallet. Please fund the owner wallet first.");
  }
  
  // Build the transaction
  const txBuilder = getTxBuilder();
  await txBuilder
    .txOut(beneficiaryAddress, [{ unit: "lovelace", quantity: amount }])
    .changeAddress(ownerAddress)
    .selectUtxosFrom(utxos)
    .complete();
  
  return txBuilder.txHex;
}

async function main() {
  try {
    // Amount to send in lovelace (5 ADA = 5,000,000 lovelace)
    const fundAmount = "5000000";
    
    console.log(`Sending ${parseInt(fundAmount) / 1000000} ADA to beneficiary address...`);
    
    const unsignedTx = await sendFunds(fundAmount);
    console.log("Transaction built successfully, signing...");
    
    const signedTx = await owner_wallet.signTx(unsignedTx);
    console.log("Transaction signed, submitting...");
    
    const txHash = await owner_wallet.submitTx(signedTx);
    console.log("Transaction submitted successfully!");
    console.log("txHash:", txHash);
    console.log(`Beneficiary wallet has been funded with ${parseInt(fundAmount) / 1000000} ADA`);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();