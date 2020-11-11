var firebase = require('firebase-admin');
var fs = require('fs')
var firebaseServiceAccount = require('./firebase-credentials.json');

firebase.initializeApp({
    credential: firebase.credential.cert(firebaseServiceAccount),
    databaseURL: 'https://steem-bid-bot.firebaseio.com/'
  });
  
var ref = firebase.database().ref('ocdb/transaction_queue');

ref.set(null)
console.log("transaction_queue removed you can close...")