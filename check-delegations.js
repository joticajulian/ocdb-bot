var firebase = require('firebase-admin');
var fs = require('fs')
var firebaseServiceAccount = require('./firebase-credentials.json');
const { Client } = require('@hivechain/dsteem');
var utils = require('./utils');
var config = require('./config.js')

var firebaseServiceAccount = require('./firebase-credentials.json');

firebase.initializeApp({
    credential: firebase.credential.cert(firebaseServiceAccount),
    databaseURL: 'https://steem-bid-bot.firebaseio.com/'
  });
  
var ref = firebase.database().ref(config.account);
const client = new Client(config.rpc_nodes[0]);

ref.child('delegators').once('value', function(snapshot){
  if(!snapshot.val()){
    console.log('no data, exit')
    return
  }
  var delegators = snapshot.val()
  checkDelegations(delegators)
});

async function checkDelegations(delegators){
  var accounts = await client.database.call('get_accounts',[[config.account]]);
  var account = accounts[0]
  var received_vesting_shares = parseFloat(account.received_vesting_shares)

  console.log("Received vesting shares: " + received_vesting_shares)
  var total_delegations = 0
  var total_delegators = 0
  var total_removed = 0
  for(var _delegator_name in delegators){
    var name = _delegator_name.replace(/[,]/g,".");
    // console.log(`checking if ${name} has delegated to ${config.account}`)

    var delegations = await client.database.call('get_vesting_delegations',[name,config.account,1])
    if(delegations.length == 0){
      // remove
      console.log(`----------------------------------------------------------------------- remove ${name}`)
      delete delegators[_delegator_name]
      total_removed++
      continue
    }
    var delegation = delegations[0]

    if(delegation && delegation.delegatee === config.account){
      console.log(`${name} has delegated ${delegation.vesting_shares} to ${config.account}`)

      // update
      delete delegators[_delegator_name].new_vesting_shares
      delegators[_delegator_name].vesting_shares = delegation.vesting_shares

      var vesting_shares = parseFloat(delegation.vesting_shares)
      total_delegations += vesting_shares
      total_delegators++
    }else{
      // remove
      console.log(`----------------------------------------------------------------------- remove ${name}`)
      delete delegators[_delegator_name]
      total_removed++
    }
  }
  var diff_delegations = received_vesting_shares - total_delegations
  console.log(`\nReceived vesting shares: ${received_vesting_shares}`)
  console.log(`Total fron delegators  : ${total_delegations}`)
  console.log(`Difference: ${diff_delegations}`)

  console.log("\nTotal delegators: "+total_delegators)
  console.log("Total removed: "+total_removed)

  ref.child('delegators').set(delegators)
  console.log("Firebase updated")
}