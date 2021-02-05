var fs = require("fs");
const steem = require('@hivechain/steem-js');
const uuidv1 = require('uuid/v1');
const { Client, PrivateKey } = require("@hiveio/dhive");
var utils = require('./utils');
var config = require('./config.js')
var firebase = require('firebase-admin');

var dsteem = null
var account = null;
var accountpay = null;
var transactions = [];
var transaction_queue = {};
var admin_operations = []
var sbd_balance = 0;
var steem_balance = 0;
var steem_power_balance = 0;
var steem_reserve_balance = 0;
var sbd_reserve_balance = 0;
var outstanding_bids = [];
var delegators = [];
var last_round = [];
var next_round = [];
var blacklist = [];
var whitelist = {};
var first_load = true;
var isClaimingRewards = false
var isHandlingTransactionQueue = false
var last_withdrawal = null;
var use_delegators = false;
var round_end_timeout = -1;
var steem_price = 1;  // This will get overridden with actual prices if a price_feed_url is specified in settings
var sbd_price = 1;    // This will get overridden with actual prices if a price_feed_url is specified in settings
var version = '1.9.3';
var state = null;
var roi = 2;
var max_bid_sbd = 9999;
var min_bid_sbd = 0.001;
var comment = '';
var bids_per_day = 1;
var max_post_age = 72*60*60 // seconds
var min_post_age = 60 // seconds
var enable_votes = true
var enable_refunds = true
var enable_payments = true
var perc_fund_account = 0.15

startup();

function loadFirebase() {
  firebase.initializeApp({
    credential: firebase.credential.cert(config.firebaseCredentials),
    databaseURL: 'https://steem-bid-bot.firebaseio.com/'
  });
  
  utils.log("Firebase started - "+config.account);
  
  var ref = firebase.database().ref(config.account);
  
  //Whitelist
  ref.child('whitelist').once('value').then(function(snapshot) {
    whitelist = snapshot.val();
    startEventsOnWhitelist();
  });
  
  //State
  ref.child('state').once('value').then(function(snapshot){
    state = snapshot.val();
    loadState();
  });
  
  //Transaction Queue
  ref.child('transaction_queue').once('value', function(data){
    if(data.val()) transaction_queue = data.val();
  });

  ref.child('admin_operations').on('value', function(data){
    if(data.val()) {
      admin_operations = data.val();
      handleAdminOperations()
    }
  })
  
  ref.child('state/roi').on('value', function(data) {
    roi = data.val();
    utils.log("roi update: "+roi);
  });
  
  ref.child('max_bid_sbd').on('value', function(data){
    max_bid_sbd = data.val();
    utils.log("max bid update: "+max_bid_sbd+" sbd");
  });
  
  ref.child('min_bid_sbd').on('value', function(data){
    min_bid_sbd = data.val();
    utils.log("min bid update: "+min_bid_sbd+" sbd");
  });

  ref.child('config/bids_per_day').on('value', function(data){
    if(data.val() >= 0){
      bids_per_day = data.val();
      utils.log("bids per day update: "+bids_per_day);
    }else{
      utils.log("error updating bids per day: data.val="+data.val())
    }
  });

  ref.child('config/max_post_age').on('value', function(data){
    max_post_age = data.val();
    utils.log("max post age update: "+max_post_age+" seconds");
  });

  ref.child('config/min_post_age').on('value', function(data){
    min_post_age = data.val();
    utils.log("min post age update: "+min_post_age+" seconds");
  });

  ref.child('config/enable_votes').on('value', function(data){
    enable_votes = data.val();
    utils.log("enable votes update: "+enable_votes);
  });
  ref.child('config/enable_refunds').on('value', function(data){
    enable_refunds = data.val();
    utils.log("enable refunds update: "+enable_refunds);
  });
  ref.child('config/enable_payments').on('value', function(data){
    enable_payments = data.val();
    utils.log("enable payments update: "+enable_payments);
  });
  ref.child('config/perc_fund_account').on('value', function(data){
    if(data.val() >= 0 && data.val()<=1){
      perc_fund_account = data.val();
      utils.log("perc_fund_account: "+perc_fund_account);
    }else{
      utils.log("error updating perc_fund_account: data.val="+data.val())
    }
  });

  ref.child('comment').on('value', function(data){
    comment = data.val();
    utils.log("comment update: "+comment);
  });
  
  //Delegators
  use_delegators = config.auto_withdrawal && config.auto_withdrawal.active && config.auto_withdrawal.accounts.find(a => a.name == '$delegators');
  
  if(use_delegators) {
    ref.child('delegators').once('value').then(function(snapshot){
      if(snapshot.val() != null) delegators = snapshot.val();

      //var vests = delegators.reduce(function (total, v) { return total + parseFloat(v.vesting_shares); }, 0);
      var vests = 0;
      var length = 0;
      for(var d in delegators){
        if(delegators[d].vesting_shares){
          var vs = parseFloat(delegators[d].vesting_shares);
          if(vs >= 0){
            vests += vs;
            length++;
          }  
        }
      }  
      utils.log('Delegators Loaded (from firebase) - ' + length + ' delegators and ' + vests + ' VESTS in total!');
    });
  }
}  
  
function startEventsOnWhitelist(){
  var ref = firebase.database().ref(config.account+'/whitelist');
  
  ref.on('child_added', function(data) {
    whitelist[data.key] = data.val();
  });
  
  ref.on('child_removed', function(data) {
    utils.log("account removed from whitelist: "+data.key);
    delete whitelist[data.key];    
  });
  
  ref.on('child_changed', function(data) {
    //utils.log("account changed from whitelist: "+data.key);    
    //utils.log(JSON.stringify(data.val()));
    whitelist[data.key] = data.val();
  });
  
  firebase.database().ref(config.account+'/delegators').on('child_changed', function(data) {
    delegators[data.key] = data.val();
    utils.log("Delegator @"+data.key+" updated his preferences: sbd_reward_percentage: "+data.val().sbd_reward_percentage+", curation_reward_percentage: "+data.val().curation_reward_percentage);
  });
}

function startup() {
  // Load the settings from the config file
  loadConfig();
  
  // Connect to the specified RPC node
  var rpc_node = config.rpc_nodes[0];
  steem.api.setOptions({ transport: 'http', uri: rpc_node, url: rpc_node });
  dsteem = new Client(rpc_node, {rebrandedApi: true});

  utils.log("* START - Version: " + version + " *");
  utils.log("Connected to: " + rpc_node);

  if(config.backup_mode)
    utils.log('*** RUNNING IN BACKUP MODE ***');

  // Load Steem global variables
  utils.updateSteemVariables();

  // If the API is enabled, start the web server
  if(config.api && config.api.enabled) {
    var express = require('express');
    var app = express();
    var port = process.env.PORT || config.api.port

    app.use(function(req, res, next) {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
      next();
    });

    app.get('/api/bids', (req, res) => res.json({ current_round: outstanding_bids, last_round: last_round }));
    app.listen(port, () => utils.log('API running on port ' + port))
  }
  
  // Load data from firebase database
  loadFirebase();


  // Check whether or not auto-withdrawals are set to be paid to delegators.
  

  // If so then we need to load the list of delegators to the account
  
  // Schedule to run every 10 seconds
  setInterval(startProcess, 10000);

  // Load updated STEEM and SBD prices every 30 minutes
  loadPrices();
  setInterval(loadPrices, 30 * 60 * 1000);
  
  // transaction queue
  setInterval(runHandleTransactionQueue, 9000);
}

function handleAdminOperations() {
  utils.log('Handling admin Operations')
  for(var i in admin_operations){
    var op = admin_operations[i]
    if(op.response) continue // operation already processed

    if(!op.admin){
      utils.log('Operation with no admin. Rejected')
      continue
    }
    utils.log('Operation from admin '+op.admin)
    if(!op.operation) {
      utils.log('There is no operation')
      continue
    }

    op.response = {
      status: 200,
      message: ''
    }

    switch(op.operation) {
      case 'relaunch_transaction':
        if(!op.key){
          op.response.status = 400
          op.response.message = 'Please define the key of the transaction'          
          break
        }

        if(!transaction_queue[op.key]) {
          op.response.status = 400
          op.response.message = 'The transaction '+op.key+' does not exists'
          break
        }

        if(!transaction_queue[op.key].history || transaction_queue[op.key].history.length == 0){
          op.response.status = 400
          op.response.message = 'This transaction does not have history'
          break        
        }

        var last_id = transaction_queue[op.key].history.length - 1
        if(transaction_queue[op.key].found){
          op.response.status = 400
          op.response.message = 'This transaction was already found in block ' + transaction_queue[op.key].block
          break          
        }
        transaction_queue[op.key].admin = op.admin
        transaction_queue[op.key].launched = false
        op.response.status = 200
        op.response.message = 'Transaction '+op.key+' relaunched by @'+op.admin+'. Operation: ' +JSON.stringify( transaction_queue[op.key].operation )
        saveTransactionQueue()
        break
      default:
        op.response.status = 400
        op.response.message = 'Operation '+op.operation+' can not be recognized'
        break      
    }
    utils.log(op.operation + '. Status ' + op.response.status + ': ' + op.response.message)    
  }
  firebase.database().ref(config.account+'/admin_operations').set(admin_operations)
}

/*
 *  This method launch transactions in queue and check if they are included
 *  in the blockchain
 */
async function runHandleTransactionQueue() {
  if(isHandlingTransactionQueue){
    utils.log('isHandlingTransactionQueue = true, wainting more')
    return
  }
  isHandlingTransactionQueue = true
  try{
    await handleTransactionQueue()
  }catch(error){
    console.log('This error should not happen, please review the code in handleTransactionQueue')
    console.log(error)
  }
  isHandlingTransactionQueue = false
}
async function handleTransactionQueue() {
  var opsToLaunch = []
  var typeKey = ''
  var usingTransfer = false;
  var available_comments = 1
  var available_votes = 1

  for(var key in transaction_queue) {

    // add properties if they are not present
    if(!transaction_queue[key].admin) transaction_queue[key].admin = ''
    if(!transaction_queue[key].found) transaction_queue[key].found = false
    if(!transaction_queue[key].history) transaction_queue[key].history = []
    if(!transaction_queue[key].retries) transaction_queue[key].retries = 0
    
    var trx = transaction_queue[key]
    var was_searched = false
    
    if(
      // if it was broadcasted
      trx.launched && 
      
      // if it is the first time we check this trx or there was an error during the last check
      !trx.found &&
      
      // wait a period of time before check (for instance, 1 minute after broadcasting)
      // new Date(trx.timeToCheck) > new Date() &&
      
      // check if the transaction has not expired. TODO: handle expirations... try again a broadcast?
      new Date(trx.time_last_block_checked + 'Z') <= new Date(trx.expiration + 'Z')
    ) 
    {
      utils.log('Time to check transaction '+key+': '+JSON.stringify(trx))
        
      // block: block number where we start to check if the transaction was performed
      var block = trx.checked_to + 1
      var time = new Date(trx.time_last_block_checked + 'Z')
      var expiration = new Date(trx.expiration + 'Z')
        
      try {
        while(time <= expiration) {
          was_searched = true
          
          var response = await searchOpInBlock(trx.operation, block)

          if(response.block != block)
            throw new Error('a valid response of searchOpInBlock does not contain the block. Response: '+JSON.stringify(response))

          if(isNaN(new Date(response.time + 'Z').getTime()))
            throw new Error('Block time in '+block+' is incorrect: '+JSON.stringify(response))
          time = new Date(response.time + 'Z')
          transaction_queue[key].checked_to = block
          transaction_queue[key].time_last_block_checked = response.time
          saveTransactionQueue()

          if(response.found){
            transaction_queue[key].found = true
            transaction_queue[key].block = block
            transaction_queue[key].transaction = response.transaction
            saveTransactionQueue()
            utils.log('A broadcasted transaction was found. Block:'+block+' tx:'+response.transaction+'. callback: '+trx.callback )
            callbackAfterTransaction(trx)
            break
          }

          block++
        }
        
        if(was_searched) {
          if(!transaction_queue[key].found) {
            utils.log('Transaction not found. key:'+key+'. Range of blocks checked: '+trx.checked_from+' - '+trx.checked_to)
            transaction_queue[key].retries++
            if( transaction_queue[key].retries < 3 ) {
              utils.log('Launching again. Retry number '+ transaction_queue[key].retries ) 
              transaction_queue[key].launched = false
            }else{
              utils.log('Retries='+transaction_queue[key].retries+'. No more retries')
              callbackCatchAfterTransaction(trx)
            }
          }

          transaction_queue[key].history.push(
            {
              admin: trx.admin,
              checked_from: transaction_queue[key].checked_from,
              checked_to: block-1,
              found: transaction_queue[key].found,
              time: new Date().toISOString().slice(0, -5)
            }
          )
          saveTransactionQueue()
        }
      } catch(error) {
        utils.log('cannot get block '+block)
        utils.log(error)
      }
      
      
    }
    else if(!trx.launched && opsToLaunch.length < 20){  // include maximum 20 operations in a transaction
      // separate transfers (active key) from votes, comments and claim rewards (posting key)
      const needActiveKey = trx.operation[0] === 'transfer' || trx.operation[0] === 'claim_reward_balance';
      if(typeKey === '') {
        opsToLaunch.push(key)
        if(needActiveKey) typeKey = 'active'
        else typeKey = 'posting'
        
        if(trx.operation[0] === 'comment') available_comments = 0
        if(trx.operation[0] === 'vote')    available_votes = 0

        if(trx.operation[0] === 'transfer') usingTransfer = true;
      }else if(
        (typeKey === 'active'  && needActiveKey) ||
        (typeKey === 'posting' && !needActiveKey)
      ){
        if(trx.operation[0] === 'comment'){
          if(available_comments>0) opsToLaunch.push(key)
          available_comments = 0
        }else if(trx.operation[0] === 'vote'){
          if(available_votes>0) opsToLaunch.push(key)
          available_votes = 0
        }else if(usingTransfer) {
          if(trx.operation[0] === 'transfer') {
            opsToLaunch.push(key);
          }
        }else {
          opsToLaunch.push(key);
        }
      }
    }
    else if(
      // if launched and found
      // trx.launched && trx.found &&

      // and it is 23 hours old
      new Date(new Date(trx.time_last_block_checked + 'Z').getTime() + 23*60*60*1000) <= Date.now()
    ){
      // then remove from queue
      delete transaction_queue[key]
      saveTransactionQueue()
    }
  }

  if(opsToLaunch.length > 0) {
    expireTime = 60 * 1000
    props = await dsteem.database.getDynamicGlobalProperties()
    if(isNaN(new Date(props.time + 'Z').getTime())) throw new Error('getDynamicGlobalProperties is incorrect: '+JSON.stringify(props))

    var operations = []
    
    for(var i in opsToLaunch) {
      var key = opsToLaunch[i]
      transaction_queue[key].checked_from = props.head_block_number
      transaction_queue[key].checked_to = props.head_block_number
      transaction_queue[key].time_last_block_checked = props.time
      transaction_queue[key].launched = true
      transaction_queue[key].timeToCheck = new Date((new Date(props.time + 'Z')).getTime() + expireTime).toISOString().slice(0, -5)
      transaction_queue[key].expiration =  new Date((new Date(props.time + 'Z')).getTime() + expireTime).toISOString().slice(0, -5)

      operations.push(transaction_queue[key].operation)
    }
    saveTransactionQueue()

    try{
      //var privKey = typeKey === 'active' ? config.active_key_pay : config.posting_key
      var privKey = config.active_key_pay;
      var response = await dsteem.broadcast.sendOperations( operations , PrivateKey.fromString(privKey) )
      if(!response.block_num) throw new Error('There is a response but no actual block_num on it. Response: '+JSON.stringify(response))
      utils.log('Transaction sent successfully with '+opsToLaunch.length+' operations. Block:'+response.block_num+' tx:'+response.id)
      for (var i in opsToLaunch) {
        var key = opsToLaunch[i]
        transaction_queue[key].found = true
        transaction_queue[key].checked_to = response.block_num
        transaction_queue[key].block = response.block_num
        transaction_queue[key].transaction = response.id 

        callbackAfterTransaction( transaction_queue[key] )
      }
      saveTransactionQueue()
    }catch(error){
      utils.log('Error broadcasting operations. Reason:')
      utils.log(error)
      console.log(operations)

      var setFoundOperation = ''
      if(error.message.includes('itr->vote_percent != o.weight')){
        setFoundOperation = 'vote'
        utils.log('Removing operation from queue because it is already voted')
      }else if(error.message.includes('_MIN_COMMENT_EDIT_INTERVAL') ){
        setFoundOperation = 'comment'
        utils.log('Removing operation from queue because it is already commented')        
      }else if(error.message.includes('Cannot claim that much VESTS')){
        utils.log('Removing operation from queue because the claims are too much')
        setFoundOperation = 'claim_reward_balance'
        isClaimingRewards = false
      }
      if(setFoundOperation !== ''){
        for (var i in opsToLaunch) {
          var key = opsToLaunch[i]
          if(transaction_queue[key].operation[0] === setFoundOperation){
            transaction_queue[key].found = true
            utils.log('setting found=true: '+JSON.stringify(transaction_queue[key]))
          }          
        }
        saveTransactionQueue()
      }
    }
  }
}

function callbackAfterTransaction(trx){
  switch(trx.callback) {
    case 'afterSendVote':
      afterSendVote(trx.operation, trx.callback_args)
      break
    case 'afterSendComment':
      afterSendComment(trx.operation, trx.callback_args)
      break
    case 'afterRefund':
      afterRefund(trx.operation, trx.callback_args)
      break
    case 'afterClaimRewards':
      afterClaimRewards(trx.operation, trx.callback_args)
      break
    case 'afterSendWithdrawal':
      afterSendWithdrawal(trx.operation, trx.callback_args)
      break
    default:
      utils.log('There is no callback called '+trx.callback)
      break
  }
}

function callbackCatchAfterTransaction(trx){
  switch(trx.callback) {
    case 'afterSendVote':
      break
    case 'afterSendComment':
      break
    case 'afterRefund':
      break
    case 'afterClaimRewards':
      utils.log('Claiming not found, setting isClaiming=false')
      isClaimingRewards = false
      break
    case 'afterSendWithdrawal':
      break
    default:
      utils.log('There is no catch callback for '+trx.callback)
      break
  }
}

async function searchOpInBlock(op, block) {
  response = await dsteem.database.getBlock(block)

  if(!response || response.witness.length<3) throw new Error('The block number '+block+' does not exists, or there are problems with the API connection')

  for(var i=0; i< response.transactions.length; i++){
    
    if(!response.transactions[i].transaction_id){
      response.transactions[i].transaction_id = response.transaction_ids[i]
    }
  
    var operations = response.transactions[i].operations
    for(var j=0; j<operations.length; j++){
      if(operations[j][0] !== op[0]) continue
      
      var valid = true
      for(var key in operations[j][1]){
        //check that all fields are the same
        if( operations[j][1][key] !== op[1][key] ){
          valid = false
          break
        }
      }
      
      if(valid){
        return {
          found: true,
          block: block,
          transaction: response.transactions[i].transaction_id,
          time: response.timestamp
        }
      }
    }
  }
  
  return {
    found: false,
    block: block,
    transaction: '',
    time: response.timestamp
  }
}

function startProcess() {
  // Load the settings from the config file each time so we can pick up any changes
  loadConfig();
  
  steem.api.getAccounts([config.accountpay], function (err, result) {
    if(!result || err){
      logError('Error loading bot account: ' + err);
      return;
    }
    accountpay = result[0];
    if(!accountpay){
      utils.log("Accountpay '"+ config.accountpay +"' can not be loaded");
      return;
    }
  });

  // Load the bot account info
  steem.api.getAccounts([config.account], function (err, result) {
    if (result && !err) {
      account = result[0];

			if (account) {
				// Load the current voting power of the account
				var vp = utils.getVotingPower(account);

				if(config.detailed_logging) {
					var bids_steem = utils.format(outstanding_bids.reduce(function(t, b) { return t + ((b.currency == 'HIVE') ? b.amount : 0); }, 0), 3);
					var bids_sbd = utils.format(outstanding_bids.reduce(function(t, b) { return t + ((b.currency == 'HBD') ? b.amount : 0); }, 0), 3);
					utils.log((config.backup_mode ? '* BACKUP MODE *' : '') + 'Voting Power: ' + utils.format(vp / 100) + '% | Time until next round: ' + utils.toTimer(utils.timeTilFullPower(vp)) + ' | Bids: ' + outstanding_bids.length + ' | ' + bids_sbd + ' HBD | ' + bids_steem + ' HIVE');
				}

        if(enable_votes){
          utils.log("Votes are enabled but the code to determine the hive price is not present. Please develop it. Votes disabled")
          enable_votes = false
        }
				if (outstanding_bids.length > 0 && enable_votes) {
                  var indexBid = 0

                  while(indexBid < outstanding_bids.length) {
                    var bid = outstanding_bids[indexBid]
                    if( (new Date() - bid.post_created) >= (min_post_age * 1000) )
                      break
                    indexBid++
                  }

                  // vote if there is one bid with the min post age
                  if(indexBid < outstanding_bids.length){

                    // calculate vote weight for the bid
                    var weight = calculateWeightVote(bid)

                    // if there is enough voting power the weight will be less than 100%
                    // then process the vote. Else do not vote, wait for more voting power.
                    // However, even if 100% voting power is not enough to reach the bid then vote to not stop the bot
                    if( weight <= 0 ) {
                      utils.log('Error: weight='+weight+'. Removing this bid. Please review. @'+bid.author+'/'+bid.permlink)
                      outstanding_bids.splice(indexBid,1);
                      saveState();
                    }else if(weight <= 10000 || vp >= 10000) {
                      bid.weight = Math.min(weight, 10000);
                      sendComment(bid);
                      sendVote(bid);

                      outstanding_bids.splice(indexBid,1);
                      saveState();
                    }
                  }
 		        }

				// Load transactions to the bot account
				getTransactions();

				// Save the state of the bot to disk
				saveState();
                
                // Save account info
                saveAccount();               

				// Check if there are any rewards to claim.
				claimRewards();

				// Check if it is time to withdraw funds.
				if (config.auto_withdrawal.frequency == 'daily' && enable_payments)
					checkAutoWithdraw();
			} else {
        if(err) logError(err);
        else logError("Error loading account: Account not defined in the result")
      }
    } else
      logError('Error loading bot account: ' + err);
  });
}

function loadState(){  
  /*if (state.last_trans)
    last_trans = state.last_trans;*/
  if (state.transactions)
      transactions = state.transactions;  

  if (state.outstanding_bids){
    outstanding_bids = state.outstanding_bids;

    //transition code: You can remove these lines after some period
    var yesterday = (new Date()).getTime() - 1000*60*60*24;
    outstanding_bids.forEach( (bid) => {      
      if(!bid.post_created) bid.post_created = yesterday
    })
  }
    
  if (state.last_round)
    last_round = state.last_round;

  if (state.next_round)
    next_round = state.next_round;
    
  if(state.last_withdrawal)
    last_withdrawal = state.last_withdrawal;
  
  if(state.roi)
    roi = state.roi;
    
  if(state.sbd_balance)
    sbd_balance = parseFloat(state.sbd_balance);
      
  if(state.steem_balance)
    steem_balance = parseFloat(state.steem_balance);
    
  if(state.steem_power_balance)
    steem_power_balance = parseFloat(state.steem_power_balance);

  if(state.steem_reserve_balance)
    steem_reserve_balance = parseFloat(state.steem_reserve_balance);
  
  if(state.sbd_reserve_balance)
    sbd_reserve_balance = parseFloat(state.sbd_reserve_balance);
    
  utils.log('Restored saved bot state: ' + JSON.stringify({ last_trx_id: (transactions.length > 0 ? transactions[transactions.length - 1] : ''), bids: outstanding_bids.length, last_withdrawal: last_withdrawal, sbd_balance: sbd_balance, steem_balance: steem_balance, steem_power_balance: steem_power_balance, steem_reserve_balance: steem_reserve_balance, sbd_reserve_balance: sbd_reserve_balance })); 
}

function calculateWeightVote(bid) {
  var vote_value = utils.getVoteValue(100, account, null, steem_price);
  if(vote_value == 0) return 100000000; // infinite: more than 100% to reach a any bid
  var vote_value_usd = vote_value

  if(sbd_price > 1)
    vote_value_usd = vote_value / 2 * sbd_price + vote_value / 2;

  weight = Math.round(10000 * roi * getUsdValue(bid)/vote_value_usd);
  return weight
}

function sendVote(bid, retries, callback) {
  utils.log('Bid Weight: ' + bid.weight);
  
  var operation = ['vote',
    {
      voter: config.account,
      author: bid.author,
      permlink: bid.permlink,
      weight: bid.weight
    }
  ]

  var key = uuidv1()

  transaction_queue[key] = {
    operation: operation,
    time: new Date().toISOString().slice(0, -5),
    callback: 'afterSendVote',
    callback_args: {} 
  }
  saveTransactionQueue()
}

function afterSendVote(operation, args) {
  utils.log(utils.format(operation[1].weight / 100) + '% vote cast for: @' + operation[1].author + '/' + operation[1].permlink);
}

function sendComment(bid) {
  /*var content = null;

  if(config.comment_location && config.comment_location != '') {
    content = fs.readFileSync(config.comment_location, "utf8");
  } else if (config.promotion_content && config.promotion_content != '') {
    content = config.promotion_content;
  }

  // If promotion content is specified in the config then use it to comment on the upvoted post
  if (content && content != '') {*/

    // Generate the comment permlink via steemit standard convention
    var permlink = 're-' + bid.author.replace(/\./g, '') + '-' + bid.permlink + '-' + new Date().toISOString().replace(/-|:|\./g, '').toLowerCase();

    // Replace variables in the promotion content
    //content = content.replace(/\{weight\}/g, utils.format(bid.weight / 100)).replace(/\{botname\}/g, config.account).replace(/\{sender\}/g, bid.sender);
    content = comment.replace(/\{weight\}/g, utils.format(bid.weight / 100)).replace(/\{botname\}/g, config.account).replace(/\{sender\}/g, bid.sender).replace(/\{author\}/g, bid.author);
    
  var operation = ['comment',
    {
      parent_author: bid.author,
      parent_permlink: bid.permlink,
      author: config.account,
      permlink: permlink,
      title: permlink,
      body: content,
      json_metadata: '{"app":"ocdb/' + version + '"}'
    }
  ]

  var key = uuidv1()

  transaction_queue[key] = {
    operation: operation,
    time: new Date().toISOString().slice(0, -5),
    callback: 'afterSendComment',
    callback_args: {}
  }
  saveTransactionQueue()
}

function afterSendComment(operation, args){
  utils.log('Posting comment: ' + operation[1].permlink);
}

function resteem(bid) {
  var json = JSON.stringify(['reblog', {
    account: config.account,
    author: bid.author,
    permlink: bid.permlink
  }]);

  steem.broadcast.customJson(config.posting_key, [], [config.account], 'follow', json, (err, result) => {
    if (!err && result) {
      utils.log('Resteemed Post: @' + bid.sender + '/' + bid.permlink);
    } else {
      utils.log('Error resteeming post: @' + bid.sender + '/' + bid.permlink);
    }
  });
}

function getTransactions(callback) {
  var last_trx_id = null;
  var num_trans = 50;

  // If this is the first time the bot is ever being run, start with just the most recent transaction
  if (first_load && transactions.length == 0) {
    utils.log('First run - starting with last transaction on account.');    
  }

  // If this is the first time the bot is run after a restart get a larger list of transactions to make sure none are missed
  if (first_load && transactions.length > 0) {
    utils.log('First run - loading all transactions since last transaction processed: ' + transactions[transactions.length - 1]);
    last_trx_id = transactions[transactions.length - 1];
    num_trans = 200;
  }

  steem.api.getAccountHistory(config.account, -1, num_trans, function (err, result) {
    if (err || !result) {
      logError('Error loading account history: ' + err);

      if (callback)
        callback();

      return;
    }else{
      // utils.log(`No error. We are reading ${result.length} txs`);
    }
    
    // On first load, just record the list of the past 50 transactions so we don't double-process them.
    if (first_load && transactions.length == 0) {
      transactions = result.map(r => r[1].trx_id).filter(t => t != '0000000000000000000000000000000000000000');
      first_load = false;

      utils.log(transactions.length + ' previous trx_ids recorded.');

      if(callback)
        callback();

      return;
    }
    
    first_load = false;
    var reached_starting_trx = false;

    for (var i = 0; i < result.length; i++) {
      var trans = result[i];
      var op = trans[1].op;
      
      // Don't need to process virtual ops
      if(trans[1].trx_id == '0000000000000000000000000000000000000000')
        continue;

      // Check that this is a new transaction that we haven't processed already
      if(transactions.indexOf(trans[1].trx_id) < 0) {

        // If the bot was restarted after being stopped for a while, don't process transactions until we're past the last trx_id that was processed
        /*if(last_trx_id && !reached_starting_trx) {
          if(trans[1].trx_id == last_trx_id)
            reached_starting_trx = true;

          continue;
        }*/

          // We only care about transfers to the bot
          if (op[0] == 'transfer' && op[1].to == config.account) {
            var amount = parseFloat(op[1].amount);
            var currency = utils.getCurrency(op[1].amount);
            
            //search for liquid steem to reserve
            if(op[1].memo.substring(0,8).toLowerCase() == 'transfer'){
              if(currency == 'HIVE') steem_reserve_balance += amount;                
              if(currency == 'HBD') sbd_reserve_balance += amount;                
              addToDebt(op[1].from,amount,currency);
            }else if(op[1].memo.replace(/\s/g,'').substring(0,4).toLowerCase() == 'http'){
              //Incoming Bid
            
              utils.log("Incoming Bid! " + trans[1].trx_id +". From: " + op[1].from + ", Amount: " + op[1].amount + ", memo: " + op[1].memo);

              // Check for min and max bid values in configuration settings
              limitbids = getMinMaxBid(currency);
              var min_bid = limitbids.min;
              var max_bid = limitbids.max;

              if(!enable_votes) {
                // Bot is disabled, refund all Bids
                refund(op[1].from, amount, currency, 'bot_disabled');
              } else if(amount < min_bid) {
                // Bid amount is too low (make sure it's above the min_refund_amount setting)
                if(!config.min_refund_amount || amount >= config.min_refund_amount)
                  refund(op[1].from, amount, currency, 'below_min_bid');
                else {
                  utils.log('Invalid bid - below min bid amount and too small to refund.');
                }
              } else if (amount > max_bid) {
                // Bid amount is too high
                refund(op[1].from, amount, currency, 'above_max_bid');
              } else if(config.currencies_accepted && config.currencies_accepted.indexOf(currency) < 0) {
                // Sent an unsupported currency
                refund(op[1].from, amount, currency, 'invalid_currency');
              } else {
                // Bid amount is just right!
                utils.log("checkpost disabled because there is no price defined")
                // checkPost(op[1].memo, amount, currency, op[1].from, 0);
              }
            }  
          } else if(use_delegators && op[0] == 'delegate_vesting_shares' && op[1].delegatee == config.account) {
            // If we are paying out to delegators, then update the list of delegators when new delegation transactions come in
            
            //var delegator = delegators.find(d => d.delegator == op[1].delegator);
            var d = dot2comma(op[1].delegator);
            var delegator = delegators[d];

            if(delegator){
              delegator.new_vesting_shares = op[1].vesting_shares;
              firebase.database().ref(config.account+'/delegators/'+d+'/new_vesting_shares').set(op[1].vesting_shares);
            }else {
			  delegator = { vesting_shares: 0, new_vesting_shares: op[1].vesting_shares, sbd_reward_percentage: 100, curation_reward_percentage: 100 };
              delegators[d] = delegator;
              
              firebase.database().ref(config.account+'/delegators/'+d).set(delegator);
			}

            // Save the updated list of delegators to disk
            //saveDelegators();

						// Check if we should send a delegation message
						if(parseFloat(delegator.new_vesting_shares) > parseFloat(delegator.vesting_shares) && config.transfer_memos['delegation'] && config.transfer_memos['delegation'] != '')
							refund(op[1].delegator, 0.001, 'HBD', 'delegation', 0, utils.vestsToSP(parseFloat(delegator.new_vesting_shares)).toFixed());

            utils.log('*** Delegation Update - ' + op[1].delegator + ' has delegated ' + op[1].vesting_shares);
          }

          // Save the ID of the last transaction that was processed.
          transactions.push(trans[1].trx_id);
          utils.log(  'Transaction digested: ' + trans[1].trx_id);

          // Don't save more than the last 300 transaction IDs in the state
          if(transactions.length > 300){
            var trx_shifted = transactions.shift();
            //utils.log('Transaction shifted:  ' + trx_shifted);
          }  
      }
    }

    if (callback)
      callback();
  });
}

function checkPost(memo, amount, currency, sender, retries) {
    // Parse the author and permlink from the memo URL
    memo = memo.replace(/\s/g,'')
    var permLink = memo.substr(memo.lastIndexOf('/') + 1);
    var site = memo.substring(memo.indexOf('://')+3,memo.indexOf('/', memo.indexOf('://')+3));
    switch(site) {
      case 'd.tube':
          var author = memo.substring(memo.indexOf("/v/")+3,memo.lastIndexOf('/'));
          break;
      case 'dmania.lol':
          var author = memo.substring(memo.indexOf("/post/")+6,memo.lastIndexOf('/'));
          break;
      default:
          var author = memo.substring(memo.lastIndexOf('@') + 1, memo.lastIndexOf('/'));
    }

    if (author == '' || permLink == '') {
      refund(sender, amount, currency, 'invalid_post_url');
      return;
    }
    
    // Make sure the author isn't on the blacklist!
    if(searchAuthor(author, whitelist) == '' && (blacklist.indexOf(author) >= 0 || blacklist.indexOf(sender) >= 0))
    {
      handleBlacklist(author, sender, amount, currency);
      return;
    }
    
    // If this bot is whitelist-only then make sure the author is on the whitelist
    if(config.blacklist_settings.whitelist_only && searchAuthor(author, whitelist) == '') {
      refund(sender, amount, currency, 'whitelist_only');
      return;
    }
    
    var authorAux = author.replace(/[.]/g,",");
    if(!whitelist[authorAux].unlimited_bids){
      if(whitelist[authorAux].last_bid){
        if(bids_per_day<=0 || whitelist[authorAux].last_bid > (new Date()).getTime() - 1000*60*60*24/bids_per_day){
          refund(sender, amount, currency, 'bids_per_day');
          return;
        }
      }else{
        utils.log("no last bid");
      }
    }else{
      utils.log('@'+authorAux+' has unlimited bids');
    }

    // Check if this author has gone over the max bids per author per round
    /*if(config.max_per_author_per_round && config.max_per_author_per_round > 0) {
      if(outstanding_bids.filter(b => b.author == author).length >= config.max_per_author_per_round)
      {
        refund(sender, amount, currency, 'bids_per_round');
        return;
      }
    }*/

    var push_to_next_round = false;

    steem.api.getContent(author, permLink, function (err, result) {
        if (!err && result && result.id > 0) {

            // If comments are not allowed then we need to first check if the post is a comment
            if(!config.allow_comments && (result.parent_author != null && result.parent_author != '')) {
              refund(sender, amount, currency, 'no_comments');
              return;
            }

            // Check if any tags on this post are blacklisted in the settings
            if (config.blacklist_settings.blacklisted_tags && config.blacklist_settings.blacklisted_tags.length > 0 && result.json_metadata && result.json_metadata != '') {
              var tags = JSON.parse(result.json_metadata).tags;

              if (tags && tags.length > 0) {
                var tag = tags.find(t => config.blacklist_settings.blacklisted_tags.indexOf(t) >= 0);

                if(tag) {
                  refund(sender, amount, currency, 'blacklist_tag', 0, tag);
                  return;
                }
              }
            }

            var created = new Date(result.created + 'Z');
            var time_until_vote = utils.timeTilFullPower(utils.getVotingPower(account));

            // Get the list of votes on this post to make sure the bot didn't already vote on it (you'd be surprised how often people double-submit!)
            var votes = result.active_votes.filter(function(vote) { return vote.voter == config.account; });

            if (votes.length > 0 || (new Date() - created) >= (max_post_age * 1000)) {
                // This post is already voted on by this bot or the post is too old to be voted on
                refund(sender, amount, currency, ((votes.length > 0) ? 'already_voted' : 'max_age'));
                return;
            }

            // Check if this post has been flagged by any flag signal accounts
            if(config.blacklist_settings.flag_signal_accounts) {
              var flags = result.active_votes.filter(function(v) { return v.percent < 0 && config.blacklist_settings.flag_signal_accounts.indexOf(v.voter) >= 0; });

              if(flags.length > 0) {
                handleFlag(sender, amount, currency);
                return;
              }
            }

            // Check if this post is below the minimum post age
            /*if(config.min_post_age && config.min_post_age > 0 && (new Date() - created + (time_until_vote * 1000)) < (config.min_post_age * 60 * 1000)) {
              push_to_next_round = true;
              refund(sender, 0.001, currency, 'min_age');
            }*/
        } else if(result && result.id == 0) {
          // Invalid memo
          refund(sender, amount, currency, 'invalid_post_url');
          return;
        } else {
          logError('Error loading post: ' + memo + ', Error: ' + err);

          // Try again on error
          if(retries < 2){
            setTimeout(function() { checkPost(memo, amount, currency, sender, retries + 1); }, 3000);
            return;
          }else {
            utils.log('============= Load post failed three times for: ' + memo + ' ===============');

            refund(sender, amount, currency, 'invalid_post_url');
            return;
          }
        }

        /*if(!push_to_next_round && checkRoundFillLimit(amount, currency)) {
          push_to_next_round = true;
          refund(sender, 0.001, currency, 'round_full');
        }*/

        // Add the bid to the current round or the next round if the current one is full or the post is too new
        //var round = push_to_next_round ? next_round : outstanding_bids;
        var round = outstanding_bids;

        // Check if there is already a bid for this post in the current round
        var existing_bid = round.find(bid => bid.url == result.url);

        if(existing_bid) {
          // There is already a bid for this post in the current round
          utils.log('Existing Bid Found - New Amount: ' + amount + ', Total Amount: ' + (existing_bid.amount + amount));

          var new_amount = 0;

          if(existing_bid.currency == currency) {
            new_amount = existing_bid.amount + amount;
          } else if(existing_bid.currency == 'HIVE') {
            new_amount = existing_bid.amount + amount * sbd_price / steem_price;
          } else if(existing_bid.currency == 'HBD') {
            new_amount = existing_bid.amount + amount * steem_price / sbd_price;
          }
          
          limitbids = getMinMaxBid(existing_bid.currency);
          var max_bid = limitbids.max;

          // Check that the new total doesn't exceed the max bid amount per post
          if (new_amount > max_bid)
            refund(sender, amount, currency, 'above_max_bid');
          else
            existing_bid.amount = new_amount;
        } else {
          // All good - push to the array of valid bids for this round
          utils.log('Valid Bid - Amount: ' + amount + ' ' + currency + ', Title: ' + result.title);
          if(currency == 'HBD') sbd_balance += amount;
          if(currency == 'HIVE') steem_balance += amount;
          round.push({
            amount: amount,
            currency: currency,
            sender: sender,
            author: result.author,
            permlink: result.permlink,
            url: result.url,
            title: result.title,
            post_created: created.getTime()
          });
          var author = result.author.replace(/[.]/g,",");
          firebase.database().ref(config.account+'/whitelist/'+author+'/last_bid').set((new Date()).getTime());  
        }

        // If a witness_vote transfer memo is set, check if the sender votes for the bot owner as witness and send them a message if not
        if (config.transfer_memos['witness_vote'] && config.transfer_memos['witness_vote'] != '') {
          checkWitnessVote(sender, sender, currency);
        } else if(!push_to_next_round && config.transfer_memos['bid_confirmation'] && config.transfer_memos['bid_confirmation'] != '') {
					// Send bid confirmation transfer memo if one is specified
					refund(sender, 0.001, currency, 'bid_confirmation', 0);
				}
    });
}

function handleBlacklist(author, sender, amount, currency) {
  utils.log('Invalid Bid - @' + author + ' is on the blacklist!');

  // Refund the bid only if blacklist_refunds are enabled in config
  if (config.blacklist_settings.refund_blacklist)
    refund(sender, amount, currency, 'blacklist_refund', 0);
  else {
    // Otherwise just send a 0.001 transaction with blacklist memo
    if (config.transfer_memos['blacklist_no_refund'] && config.transfer_memos['blacklist_no_refund'] != '')
      refund(sender, 0.001, currency, 'blacklist_no_refund', 0);

    // If a blacklist donation account is specified then send funds from blacklisted users there
    if (config.blacklist_settings.blacklist_donation_account)
      refund(config.blacklist_settings.blacklist_donation_account, amount - 0.001, currency, 'blacklist_donation', 0);
  }
}

function handleFlag(sender, amount, currency) {
  utils.log('Invalid Bid - This post has been flagged by one or more spam / abuse indicator accounts.');

  // Refund the bid only if blacklist_refunds are enabled in config
  if (config.blacklist_settings.refund_blacklist)
    refund(sender, amount, currency, 'flag_refund', 0);
  else {
    // Otherwise just send a 0.001 transaction with blacklist memo
    if (config.transfer_memos['flag_no_refund'] && config.transfer_memos['flag_no_refund'] != '')
      refund(sender, 0.001, currency, 'flag_no_refund', 0);

    // If a blacklist donation account is specified then send funds from blacklisted users there
    if (config.blacklist_settings.blacklist_donation_account)
      refund(config.blacklist_settings.blacklist_donation_account, amount - 0.001, currency, 'blacklist_donation', 0);
  }
}

function checkWitnessVote(sender, voter, currency) {
  if(!config.owner_account || config.owner_account == '')
    return;

  steem.api.getAccounts([voter], function (err, result) {
    if (result && !err) {
      if (result[0].proxy && result[0].proxy != '') {
        checkWitnessVote(sender, result[0].proxy, currency);
        return;
      }

      if(result[0].witness_votes.indexOf(config.owner_account) < 0)
        refund(sender, 0.001, currency, 'witness_vote', 0);
		  else if(config.transfer_memos['bid_confirmation'] && config.transfer_memos['bid_confirmation'] != '') {
				// Send bid confirmation transfer memo if one is specified
				refund(sender, 0.001, currency, 'bid_confirmation', 0);
			}
    } else
      logError('Error loading sender account to check witness vote: ' + err);
  });
}

function saveState() {
  var state = {
    outstanding_bids: outstanding_bids,
    last_round: last_round,
    next_round: next_round,
    transactions: transactions,
    last_withdrawal: last_withdrawal,
    sbd_balance: sbd_balance.toFixed(3),
    steem_balance: steem_balance.toFixed(3),
    steem_power_balance: steem_power_balance.toFixed(3),
    steem_reserve_balance: steem_reserve_balance.toFixed(3),
    sbd_reserve_balance: sbd_reserve_balance.toFixed(3),
    roi: roi,
    version: version
  };

  // Save the state of the bot to firebase
  firebase.database().ref(config.account+'/state').set(state);  
}

function saveTransactionQueue() {
  firebase.database().ref(config.account+'/transaction_queue').set(transaction_queue)
}

function saveAccount(){
  firebase.database().ref(config.account+'/account').set(account);
}

/*
function updateVersion(old_version, new_version) {
  utils.log('**** Performing Update Steps from version: ' + old_version + ' to version: ' + new_version);

  if(!old_version) {
    if(fs.existsSync('delegators.json')) {
      fs.rename('delegators.json', 'old-delegators.json', (err) => {
        if (err)
          utils.log('Error renaming delegators file: ' + err);
        else
          utils.log('Renamed delegators.json file so it will be reloaded from account history.');
      });
    }
  }
}*/

/*function saveDelegators() {
  // Save the list of delegators to firebase
  firebase.database().ref(config.account+'/delegators').set(delegators);    
}*/

function refund(sender, amount, currency, reason, retries, data) {
  if(config.backup_mode) {
    utils.log('Backup Mode - not sending refund of ' + amount + ' ' + currency + ' to @' + sender + ' for reason: ' + reason);
    return;
  }
  if(!enable_refunds) {
    utils.log('Refunds not enabled. ' + amount + ' ' + currency + ' to @' + sender + ' for reason: ' + reason);
    return;
  }

  if(!retries)
    retries = 0;

  // Make sure refunds are enabled and the sender isn't on the no-refund list (for exchanges and things like that).
  if (reason != 'forward_payment' && (!config.refunds_enabled || sender == config.account || (config.no_refund && config.no_refund.indexOf(sender) >= 0))) {
    utils.log("Invalid bid - " + reason + ' NO REFUND');

    // If this is a payment from an account on the no_refund list, forward the payment to the post_rewards_withdrawal_account
    if(config.no_refund && config.no_refund.indexOf(sender) >= 0 && config.post_rewards_withdrawal_account && config.post_rewards_withdrawal_account != '' && sender != config.post_rewards_withdrawal_account)
      refund(config.post_rewards_withdrawal_account, amount, currency, 'forward_payment', 0, sender);

    return;
  }
  
  limitbids = getMinMaxBid(currency);
  
  // Replace variables in the memo text
  var memo = config.transfer_memos[reason];
  memo = memo.replace(/{amount}/g, utils.format(amount, 3) + ' ' + currency);
  memo = memo.replace(/{currency}/g, currency);
  memo = memo.replace(/{min_bid}/g, (limitbids.min.toFixed(3)+' '+currency));
  memo = memo.replace(/{max_bid}/g, (limitbids.max.toFixed(3)+' '+currency));
  memo = memo.replace(/{account}/g, config.account);
  memo = memo.replace(/{owner}/g, config.owner_account);
  memo = memo.replace(/{sender}/g, sender);
  memo = memo.replace(/{tag}/g, data);
  memo = memo.replace(/{bids_per_day}/g, (bids_per_day*24).toFixed(1));

  var days = Math.floor(max_post_age / (24*60*60));
  var hours = (max_post_age % (24*60*60));
  memo = memo.replace(/{max_age}/g, days + ' Day(s)' + ((hours > 0) ? ' ' + hours + ' Hour(s)' : ''));

  var operation = ['transfer',
    {
      from: config.accountpay,
      to: sender,
      amount: utils.format(amount, 3) + ' ' + currency,
      memo: memo
    }
  ]

  var key = uuidv1()

  transaction_queue[key] = {
    operation: operation,
    time: new Date().toISOString().slice(0, -5),
    callback: 'afterRefund',
    callback_args: {
      reason: reason
    }
  }
  saveTransactionQueue()
}

function afterRefund(operation, args) {
  utils.log('Refund of ' + operation[1].amount + ' sent to @' + operation[1].to + ' for reason: ' + args.reason);
}

function claimRewards() {
  if (!config.auto_claim_rewards || config.backup_mode)
    return;

  // Make api call only if you have actual reward
  if (parseFloat(account.reward_hive_balance) <= 0 && parseFloat(account.reward_hbd_balance) <= 0 && parseFloat(account.reward_vesting_balance) <= 0)
    return

  if (isClaimingRewards) return

  var operation = ['claim_reward_balance',
    {
      account: config.account,
      reward_hive: account.reward_hive_balance,
      reward_hbd: account.reward_hbd_balance,
      reward_vests: account.reward_vesting_balance
    }
  ]

  var key = uuidv1()

  transaction_queue[key] = {
    operation: operation,
    time: new Date().toISOString().slice(0, -5),
    callback: 'afterClaimRewards',
    callback_args: {}
  }
  saveTransactionQueue()
  isClaimingRewards = true
}

function afterClaimRewards(operation, args) {
  sbd_balance += parseFloat(operation[1].reward_hbd);
  steem_balance += parseFloat(operation[1].reward_hive);
  steem_power_balance += utils.vestsToSP(parseFloat(operation[1].reward_vests));

  var d = dot2comma(config.account);

  delegators[d] = {
    curation_reward_percentage: 100,
    sbd_reward_percentage: 100,
    vesting_shares: account.vesting_shares,
  };

  firebase.database().ref(config.account+'/delegators/'+d).set(delegators[d]);
  isClaimingRewards = false

  if(config.detailed_logging) {
    var rewards_message = "$$$ ==> Rewards Claim";
    if (parseFloat(operation[1].reward_hbd) > 0) { rewards_message = rewards_message + ' HBD: ' + parseFloat(operation[1].reward_hbd); }
    if (parseFloat(operation[1].reward_hive) > 0) { rewards_message = rewards_message + ' HIVE: ' + parseFloat(operation[1].reward_hive); }
    if (parseFloat(operation[1].reward_vests) > 0) { rewards_message = rewards_message + ' VESTS: ' + parseFloat(operation[1].reward_vests); }
    utils.log(rewards_message);      
  }
}

function checkAutoWithdraw() {
  // Check if auto-withdraw is active
  if (!config.auto_withdrawal.active)
    return;

  // If it's past the withdrawal time and we haven't made a withdrawal today, then process the withdrawal
  if (new Date(new Date().toDateString()) > new Date(last_withdrawal) && new Date().getHours() >= config.auto_withdrawal.execute_time) {
    processWithdrawals();
  }
}

function processWithdrawals() {
  if(config.backup_mode)
    return;

  // var liquid_steem_power = steem_reserve_balance >= steem_power_balance ? steem_power_balance : steem_reserve_balance;
  utils.log("Withdrawals. sbd_balance="+sbd_balance+"  steem_balance="+steem_balance+"  liquid_steem_power="+liquid_steem_power);

  var sbd_bal = parseFloat(accountpay.sbd_balance);
  var sbd_bal = sbd_balance >= sbd_bal ? sbd_bal : sbd_balance;
  var steem_bal = parseFloat(accountpay.balance) - liquid_steem_power;
  var steem_bal = steem_bal < 0 ? 0 : steem_bal;
  var steem_bal = steem_balance >= steem_bal ? steem_bal : steem_balance;
  
  // steem_bal: Steem received in bids... limit with the account balance
  var steem_bal = parseFloat(accountpay.balance);
  var steem_bal = steem_balance >= steem_bal ? steem_bal : steem_balance;

  var liquid_steem_power = 0
  var available_steem_for_curation = parseFloat(accountpay.balance) - steem_bal
  if( available_steem_for_curation > 0){
    // there is still STEEM in the account to pay curation
    liquid_steem_power = available_steem_for_curation >= steem_power_balance ? steem_power_balance : available_steem_for_curation;
  }
  
  var has_sbd = config.currencies_accepted.indexOf('HBD') >= 0 && sbd_bal > 0;
  var has_steem = config.currencies_accepted.indexOf('HIVE') >= 0 && steem_bal > 0;
  var has_steem_power = liquid_steem_power > 0;  
  
  utils.log("Withdrawals. sbd_bal="+sbd_bal+"  steem_bal="+steem_bal+"  liquid_steem_power="+liquid_steem_power);

  if (has_sbd || has_steem || has_steem_power) {

    // Save the date of the last withdrawal
    last_withdrawal = new Date().toDateString();

    var total_stake = config.auto_withdrawal.accounts.reduce(function (total, info) { return total + info.stake; }, 0);

    var withdrawals = [];

    //fund account payment
    if(has_sbd) {
      var amountSBDfund = sbd_bal * perc_fund_account
      if(amountSBDfund.toFixed(3) !== '0.000'){
        withdrawals.push({
          to: config.fund_account,
          currency: 'HBD',
          amount: amountSBDfund,
          amountSP: 0,
          donation: 0,
          donationSP: 0,
          delegator: config.fund_account
        });
        sbd_bal -= amountSBDfund
      }
    }

    if(has_steem || has_steem_power) {
      var amountSteemfund = steem_bal * perc_fund_account
      var amountSPfund = liquid_steem_power * perc_fund_account
      if(amountSteemfund.toFixed(3) !== '0.000' || amountSPfund.toFixed(3) !== '0.000'){
        withdrawals.push({
          to: config.fund_account,
          currency: 'HIVE',
          amount: amountSteemfund,
          amountSP: amountSPfund,
          donation: 0,
          donationSP: 0,
          delegator: config.fund_account
        });
      }
      steem_bal -= amountSteemfund
      liquid_steem_power -= amountSPfund
    }

    for(var i = 0; i < config.auto_withdrawal.accounts.length; i++) {
      var withdrawal_account = config.auto_withdrawal.accounts[i];
        
        // Get the total amount delegated by all delegators
        //var total_vests = delegators.reduce(function (total, v) { return total + parseFloat(v.vesting_shares); }, 0);
        var total_vests = 0;
        for(var d in delegators){
          if(delegators[d].vesting_shares){
            var vs = parseFloat(delegators[d].vesting_shares);
            if(vs >= 0) total_vests += vs;
          }
        }

        // Send the withdrawal to each delegator based on their delegation amount
        //for(var j = 0; j < delegators.length; j++) {
        for(var d in delegators){
          var delegator = delegators[d];
          var to_account = comma2dot(d);
          var unencrypted_memo = null
          if(delegator.send_to) to_account = comma2dot(delegator.send_to);
          if(delegator.unencrypted_memo) unencrypted_memo = delegator.unencrypted_memo

          if(has_sbd) {
            // Check if there is already an SBD withdrawal to this account
            var withdrawal = withdrawals.find(w => w.to == to_account && w.currency == 'HBD');
            var perc_sbd = parseFloat(delegator.sbd_reward_percentage) / 100;
            perc_sbd = perc_sbd < 0 ? 0 : (perc_sbd>1 ? 1 : perc_sbd);
            var amountSBD = sbd_bal * (withdrawal_account.stake / total_stake) * (parseFloat(delegator.vesting_shares) / total_vests) - 0.001;
            var paymentSBD = perc_sbd * amountSBD;
            var donationSBD = amountSBD - paymentSBD;
            paymentSBD = paymentSBD > 0 ? paymentSBD : 0;
            donationSBD = donationSBD > 0 ? donationSBD : 0;

            if(withdrawal) {
              withdrawal.amount += paymentSBD;
            } else {
              withdrawals.push({
                to: to_account,
                currency: 'HBD',
                amount: paymentSBD,
                amountSP: 0,
                donation: donationSBD,
                donationSP: 0,
                delegator: d,
                unencrypted_memo: unencrypted_memo
              });
            }
          }

          if(has_steem || has_steem_power) {
            // Check if there is already a STEEM withdrawal to this account
            var withdrawal = withdrawals.find(w => w.to == to_account && w.currency == 'HIVE');
            var perc_steem = parseFloat(delegator.sbd_reward_percentage) / 100;
            var perc_sp = parseFloat(delegator.curation_reward_percentage) / 100;
            perc_steem = perc_steem < 0 ? 0 : (perc_steem>1 ? 1 : perc_steem);            
            perc_sp = perc_sp < 0 ? 0 : (perc_sp>1 ? 1 : perc_sp);
            
            var amountSteem = steem_bal * (withdrawal_account.stake / total_stake) * (parseFloat(delegator.vesting_shares) / total_vests) - 0.001;
            var amountSP = liquid_steem_power * (withdrawal_account.stake / total_stake) * (parseFloat(delegator.vesting_shares) / total_vests) - 0.001;
            
            var paymentSteem = perc_steem * amountSteem;
            var paymentSP = perc_sp * amountSP;
            var donationSteem = amountSteem - paymentSteem;
            var donationSP = amountSP - paymentSP;
            
            paymentSteem = paymentSteem > 0 ? paymentSteem : 0;
            paymentSP = paymentSP > 0 ? paymentSP : 0;
            donationSteem = donationSteem > 0 ? donationSteem : 0;
            donationSP = donationSP > 0 ? donationSP : 0;            

            if(withdrawal) {
              withdrawal.amount += paymentSteem;
              withdrawal.amountSP += paymentSP;
            } else {
              withdrawals.push({
                to: to_account,
                currency: 'HIVE',
                amount: paymentSteem,
                amountSP: paymentSP,
                donation: donationSteem,
                donationSP: donationSP,
                delegator: d,
                unencrypted_memo: unencrypted_memo
              });
            }
          }
        }      
    }

    // Check if the memo should be encrypted
    var encrypt = (config.auto_withdrawal.memo.startsWith('#') && config.memo_key && config.memo_key != '');

    if(encrypt) {
      // Get list of unique withdrawal account names
      var account_names = withdrawals.map(w => w.to).filter((v, i, s) => s.indexOf(v) === i);

      // Load account info to get memo keys for encryption
      steem.api.getAccounts(account_names, function (err, result) {
        if (result && !err) {
          for(var i = 0; i < result.length; i++) {
            var withdrawal_account = result[i];
            var matches = withdrawals.filter(w => w.to == withdrawal_account.name);

            for(var j = 0; j < matches.length; j++) {
              matches[j].memo_key = withdrawal_account.memo_key;
            }
          }

          sendWithdrawals(withdrawals);
        } else
          logError('Error loading withdrawal accounts: ' + err);
      });
    } else
      sendWithdrawals(withdrawals);
  }

  updateDelegations();
}

function updateDelegations() {
  for(var d in delegators){
    var delegator = delegators[d]; 
    if(parseFloat(delegator.new_vesting_shares) >= 0){
      delegator.vesting_shares = delegator.new_vesting_shares;
      delegator.new_vesting_shares = null;
      firebase.database().ref(config.account+'/delegators/'+d).set(delegator);
    }
  }  
}

function sendWithdrawals(withdrawals) {
  /*
  // Send out withdrawal transactions one at a time
  sendWithdrawal(withdrawals.pop(), 0, function() {
    // If there are more withdrawals, send the next one.
    if (withdrawals.length > 0)
      sendWithdrawals(withdrawals);
    else
      utils.log('========== Withdrawals on transaction_queue! ==========');
  });*/
  for(var i in withdrawals){
    sendWithdrawal(withdrawals[i])
  }
  utils.log('========== '+withdrawals.length+' Withdrawals on transaction_queue! ==========');
}

function sendWithdrawal(withdrawal, retries, callback) {
  if(parseFloat(utils.format(withdrawal.amount, 3)) <= 0) {
    if(!withdrawal.amountSP || parseFloat(utils.format(withdrawal.amountSP, 3)) <= 0){
      if(callback)
        callback();

      return;
    }  
  }
  
  var amount = withdrawal.amount;
  if(withdrawal.amountSP) amount += withdrawal.amountSP;

  var formatted_amount = utils.format(amount, 3).replace(/,/g, '') + ' ' + withdrawal.currency;
  var memo = config.auto_withdrawal.memo.replace(/\{balance\}/g, formatted_amount);

  // Encrypt memo
  if (memo.startsWith('#') && config.memo_key && config.memo_key != '')
    memo = steem.memo.encode(config.memo_key, withdrawal.memo_key, memo);

  if(withdrawal.unencrypted_memo)
    memo = withdrawal.unencrypted_memo

  var operation = ['transfer',
    {
      from: config.accountpay,
      to: withdrawal.to,
      amount: formatted_amount,
      memo: memo
    }
  ]
  
  var key = uuidv1()

  transaction_queue[key] = {
    operation: operation,
    time: new Date().toISOString().slice(0, -5),
    callback: 'afterSendWithdrawal',
    callback_args: {
      delegator:  withdrawal.delegator,
      amount:     withdrawal.amount,
      amountSP:   withdrawal.amountSP,
      donation:   withdrawal.donation,
      donationSP: withdrawal.donationSP,
    }
  }
  saveTransactionQueue()

  if(callback) callback()
}

function afterSendWithdrawal(operation,args) {
  utils.log('$$$ Auto withdrawal: ' + operation[1].amount + ' sent to @' + operation[1].to);
  var d = args.delegator;
  var amount = parseFloat(operation[1].amount)
  var currency = utils.getCurrency(operation[1].amount);

  if(currency == 'HBD'){
    sbd_balance -= args.amount;
    if(d === config.fund_account) return

    if(delegators[d].donation_sbd)
      delegators[d].donation_sbd += args.donation;
    else
      delegators[d].donation_sbd = args.donation;
  }

  if(currency == 'HIVE'){
    steem_balance -= args.amount;
    steem_power_balance -= args.amountSP;
    steem_reserve_balance -= args.amountSP;
    if(d === config.fund_account) return

    if(delegators[d].donation_steem)
      delegators[d].donation_steem += args.donation;
    else
      delegators[d].donation_steem = args.donation;

    if(delegators[d].donation_sp)
      delegators[d].donation_sp += args.donationSP;
    else
      delegators[d].donation_sp = args.donationSP;
  }

  firebase.database().ref(config.account+'/delegators/'+d).set(delegators[d]);
}

function loadPrices() {
  // Require the "request" library for making HTTP requests
  var request = require("request");

  // Load the price feed data
  // TODO: Take price from an exchange
  steem_price = null
  /*request.get('https://api.coinmarketcap.com/v1/ticker/steem/', function (e, r, data) {
    try {
      steem_price = parseFloat(JSON.parse(data)[0].price_usd);

      utils.log("Loaded HIVE price: " + steem_price);
    } catch (err) {
      utils.log('Error loading HIVE price: ' + err);
    }
  });

  // Load the price feed data
  request.get('https://api.coinmarketcap.com/v1/ticker/steem-dollars/', function (e, r, data) {
    try {
      sbd_price = parseFloat(JSON.parse(data)[0].price_usd);

      utils.log("Loaded SBD price: " + sbd_price);
    } catch (err) {
      utils.log('Error loading SBD price: ' + err);
    }
  });*/
}

function getUsdValue(bid) { return bid.amount * ((bid.currency == 'HBD') ? sbd_price : steem_price); }
function getSteemSBDValue(usd,currency){ return usd / ((currency == 'HBD') ? sbd_price : steem_price); }

function getMinMaxBid(currency){
  var min_bid;
  var max_bid;
  if(currency == 'HBD'){
    min_bid = min_bid_sbd;
    max_bid = max_bid_sbd;
  }else{
    min_bid = min_bid_sbd * sbd_price / steem_price;
    max_bid = max_bid_sbd * sbd_price / steem_price;    
  }
  return {min: min_bid, max:max_bid};
}

function logFailedBid(bid, message) {
  if (message.indexOf('assert_exception') >= 0 && message.indexOf('ERR_ASSERTION') >= 0)
    return;

  var failed_bids = [];

  if(fs.existsSync("failed-bids.json"))
    failed_bids = JSON.parse(fs.readFileSync("failed-bids.json"));

  bid.error = message;
  failed_bids.push(bid);

  fs.writeFile('failed-bids.json', JSON.stringify(failed_bids), function (err) {
    if (err)
      utils.log('Error saving failed bids to disk: ' + err);
  });
}

function loadConfig() {
  //config = JSON.parse(fs.readFileSync("config.json"));

  // Backwards compatibility for blacklist settings
  if(!config.blacklist_settings) {
    config.blacklist_settings = {
      flag_signal_accounts: config.flag_signal_accounts,
      blacklist_location: config.blacklist_location ? config.blacklist_location : 'blacklist',
      refund_blacklist: config.refund_blacklist,
      blacklist_donation_account: config.blacklist_donation_account,
      blacklisted_tags: config.blacklisted_tags
    };
  }

  var newBlacklist = [];

  // Load the blacklist
  utils.loadUserList(config.blacklist_settings.blacklist_location, function(list1) {
    var list = [];

    if(list1)
      list = list1;

    // Load the shared blacklist
    utils.loadUserList(config.blacklist_settings.shared_blacklist_location, function(list2) {
      if(list2)
        list = list.concat(list2.filter(i => list.indexOf(i) < 0));

      if(list1 || list2)
        blacklist = list;
    });
  });
}

function failover() {
  if(config.rpc_nodes && config.rpc_nodes.length > 1) {
    // Give it a minute after the failover to account for more errors coming in from the original node
    setTimeout(function() { error_count = 0; }, 60 * 1000);
  
    var cur_node_index = config.rpc_nodes.indexOf(steem.api.options.url) + 1;

    if(cur_node_index == config.rpc_nodes.length)
      cur_node_index = 0;

    var rpc_node = config.rpc_nodes[cur_node_index];

    steem.api.setOptions({ transport: 'http', uri: rpc_node, url: rpc_node });
    utils.log('');
    utils.log('***********************************************');
    utils.log('Failing over to: ' + rpc_node);
    utils.log('***********************************************');
    utils.log('');
  }
}

var error_count = 0;
function logError(message) {
  // Don't count assert exceptions for node failover
  if (message.indexOf('assert_exception') < 0 && message.indexOf('ERR_ASSERTION') < 0)
    error_count++;

  utils.log('Error Count: ' + error_count + ', Current node: ' + steem.api.options.url);
  utils.log(message);
}

// Check if 10+ errors have happened in a 3-minute period and fail over to next rpc node
function checkErrors() {
  if(error_count >= 10)
    failover();

  // Reset the error counter
  error_count = 0;
}
setInterval(checkErrors, 3 * 60 * 1000);

function searchAuthor(author, list){
  for(var key in list) {
    //if(list[key] == author) return key;
    acc = key.replace(/[,]/g,".");
    if(acc == author) return author;
  }
  return '';
}

function comma2dot(name){
  return name.replace(/[,]/g,".");
}

function dot2comma(name){
  return name.replace(/[.]/g,",");
}

function addToDebt(user,newAmount,currency){
  var ref = firebase.database().ref(config.account+'/debt/'+user+'/'+currency.toLowerCase());
  ref.once('value').then(function(snapshot){
    var amount = snapshot.val() > 0 ? snapshot.val() : 0;
    ref.set(amount + newAmount);
  });  
  utils.log("Transfer to reserve from @"+user+": "+newAmount+" "+currency);
}
