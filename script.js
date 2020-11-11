var firebase = require('firebase-admin');
var firebaseServiceAccount = require('./firebase-credentials.json');

firebase.initializeApp({
    credential: firebase.credential.cert(firebaseServiceAccount),
    databaseURL: 'https://steem-bid-bot.firebaseio.com/'
  });
  
var ref = firebase.database().ref('ocdb');
  
ref.child('transaction_queue').once('value', function(data){
    if(!data.val()) console.log('no data, exit')
    
    transaction_queue = data.val();
    for(var key in transaction_queue) {
        var trx = transaction_queue[key]
        
        /*if(trx.callback === 'afterClaimRewards'){
           console.log('deleting '+key)
           delete transaction_queue[key]            
        }*/
        
        var user = 'NO'
        var found = trx.found ? 'OK' : 'Pending'
        switch(trx.operation[0]){
            
            case 'comment':
               user = trx.operation[1].parent_author
               break
            case 'vote':
               user = trx.operation[1].author + '  ' + trx.operation[1].weight
               break
            default:
               break
        }
        if(!trx.found)
            console.log(trx.callback + '   ' + user + '    ' + found + '  retries ' +trx.retries)
        
    }
    console.log('end for')
    //firebase.database().ref('ocdb/transaction_queue').set(transaction_queue)
  });