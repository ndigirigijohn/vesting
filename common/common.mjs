import 'dotenv/config';
import {
  MeshWallet,
  BlockfrostProvider,
  MeshTxBuilder,
  serializePlutusScript,
} from "@meshsdk/core";
import { applyParamsToScript } from "@meshsdk/core-csl";
import fs, { read } from 'fs';
 
 
export const blockchainProvider = new BlockfrostProvider(process.env.BLOCKFROST_API);
 
 
export const owner_wallet = new MeshWallet({
  networkId: 0,
  fetcher: blockchainProvider,
  submitter: blockchainProvider,
  key: {
    type: "root",
    bech32: fs.readFileSync("owner.sk").toString(),
  },
});
 
export const beneficiary_wallet = new MeshWallet({
  networkId: 0,
  fetcher: blockchainProvider,
  submitter: blockchainProvider,
  key: {
    type: "root",
    bech32: fs.readFileSync("beneficiary.sk").toString(),
  },
});
 
export function getTxBuilder() {
  return new MeshTxBuilder({
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
    verbose: true, // <-- you can remove this if you dont want to see logs
 
  });
}
 
const blueprint = JSON.parse(fs.readFileSync("./plutus.json"));
export const scriptCbor = applyParamsToScript(blueprint.validators[0].compiledCode, []);
export const scriptAddr = serializePlutusScript(
  { code: scriptCbor, version: "V3" },
  undefined,
  0
).address;
 
 