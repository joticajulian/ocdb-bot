var firebase = require('firebase-admin');
var fs = require('fs')
var firebaseServiceAccount = require('./firebase-credentials.json');

firebase.initializeApp({
    credential: firebase.credential.cert(firebaseServiceAccount),
    databaseURL: 'https://steem-bid-bot.firebaseio.com/'
  });
  
var ref = firebase.database().ref('ocdb');
  
ref.once('value', function(snapshot){
  if(!snapshot.val()){
    console.log('no data, exit')
    return
  }
  console.log("Data loaded from firebase")
  var data = snapshot.val()
  var now = new Date().getTime()
  var filename = "backup-" + now + ".json"
  fs.writeFileSync(filename, JSON.stringify(data, null, 2))
  console.log("Backup saved in "+filename)
  process.exit(0)
})
