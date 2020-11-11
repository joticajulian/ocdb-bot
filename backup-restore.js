var firebase = require('firebase-admin');
var fs = require('fs')
var firebaseServiceAccount = require('./firebase-credentials.json');

var filename = process.argv[2]
if(!filename) throw new Error("Define filename. Example: node backup-restore.js backup1.json")

firebase.initializeApp({
    credential: firebase.credential.cert(firebaseServiceAccount),
    databaseURL: 'https://steem-bid-bot.firebaseio.com/'
  });
  
var ref = firebase.database().ref('ocdb');
var datastring = fs.readFileSync(filename, 'utf-8')
var data = JSON.parse(datastring)

ref.set(data)
console.log(filename + " restored in firebase ")
console.log("you can close...")