var firebase = require('firebase-admin');
var fs = require("fs");
const { Client, PrivateKey } = require("@hiveio/dhive");
const axios = require("axios");
var utils = require('./utils');
var config = require('./config.js')

firebase.initializeApp({
    credential: firebase.credential.cert(config.firebaseCredentials),
    databaseURL: 'https://steem-bid-bot.firebaseio.com/'
});
  
var ref = firebase.database().ref(config.account);
const rpcNode = config.rpc_nodes[0];
const client = new Client(rpcNode, {rebrandedApi: true});

let ocdbDelegations = [];

(async () => {
  const [account] = await client.database.call("get_accounts", [[config.account]]);
  const received_vesting_shares = parseFloat(account.received_vesting_shares);
  let start = ["a-pile-of-steem", "lafona-miner"];
  while(true) {
    const { data: { result: { delegations: delegations } } }= await axios.post(rpcNode, {
      jsonrpc: "2.0",
      method:"database_api.list_vesting_delegations",
      params: { start, limit: 1000, order: "by_delegation" },
      id: 10
    });
    const filtered = delegations.filter(d => d.delegatee === "ocdb");
    if(filtered.length > 0){
       ocdbDelegations = ocdbDelegations.concat(filtered);
       fs.writeFileSync("ocdb_delegations.json", JSON.stringify(ocdbDelegations, null, 2));
    }
    const last = delegations[ delegations.length - 1];
    start = [last.delegator, last.delegatee];
    console.log(start)
  }
  
  process.exit(1);
})()
