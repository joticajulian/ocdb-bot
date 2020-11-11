var fs = require("fs");
var firebase = require('firebase-admin');
var firebaseServiceAccount = require('./firebase-credentials.json');
var steem = require("steem")
const { Client } = require('dsteem')

config = JSON.parse(fs.readFileSync("config.json"));

firebase.initializeApp({
  credential: firebase.credential.cert(firebaseServiceAccount),
  databaseURL: 'https://steem-bid-bot.firebaseio.com/'
});

var rpc_node = config.rpc_nodes ? config.rpc_nodes[0] : (config.rpc_node ? config.rpc_node : 'https://api.steemit.com');
steem.api.setOptions({ transport: 'http', uri: rpc_node, url: rpc_node });
dsteem = new Client(rpc_node);
  

firebase.database().ref(config.account+'/whitelist').once('value')
.then(async function(data){
  
  for(key in data.val()){
    user = key.replace(/[,]/g,".");
    try{
      var accounts = await dsteem.database.getAccounts([user])
      if(accounts.length == 0) {
        console.log('the user @'+user+' does not exists')
      }
    }catch(error){
      console.log('error with the user @'+user)
    }
    
  }
})
.catch(function(error){
  console.log('Error reading firebase database')
  console.log(error)
})
