var firebase = require('firebase-admin');
var firebaseServiceAccount = require('./firebase-credentials.json');

firebase.initializeApp({
    credential: firebase.credential.cert(firebaseServiceAccount),
    databaseURL: 'https://steem-bid-bot.firebaseio.com/'
  });
  
var ref = firebase.database().ref('ocdb');
  
ref.child('transaction_queue').once('value', function(data){
    if(!data.val()) console.log('no data, exit')
    
    var transaction_queue = data.val();
    //var key = 'ec28a0a0-92cc-11e9-a085-c70a72b0fe79'
    //var key = 'e97651e0-92cc-11e9-a085-c70a72b0fe79'
    var key = 'e92524a0-92cc-11e9-a085-c70a72b0fe79'
    console.log( transaction_queue[key] )
  });