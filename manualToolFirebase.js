var fs = require("fs");
var firebase = require('firebase-admin');
var firebaseServiceAccount = require('./firebase-credentials.json');

config = JSON.parse(fs.readFileSync("config.json"));
ocdwhitelist = fs.readFileSync("voted_by_ocdb.txt", "utf8").replace(/[\r',]/g, '').split('\n');

firebase.initializeApp({
  credential: firebase.credential.cert(firebaseServiceAccount),
  databaseURL: 'https://steem-bid-bot.firebaseio.com/'
});

/*copyKey('whitelist','pruebas','ocdb');
copyKey('admins','pruebas','ocdb');
copyKey('globalPropertiesSteem','pruebas','ocdb');*/
//delegatorsFromArrayToObject();
//renameDele2Delegators();
createWhitelist();

//insertLastBid();

function insertLastBid(){
  var yesterday = (new Date()).getTime() - 1000*60*60*24;
  var val_user = {
    last_bid: yesterday,
  };  
  
  firebase.database().ref(config.account+'/whitelist').once('value').then(function(data){
    for(var user in data.val()){
      firebase.database().ref(config.account+'/whitelist/'+user).set(val_user);
    }
    console.log("listo modificados");    
  });
}

function createWhitelist(){
  whi = {};
  var yesterday = (new Date()).getTime() - 1000*60*60*24;
  var da = {
    last_bid: yesterday,
  }
  for(var i=0;i<ocdwhitelist.length;i++){
    var acc = ocdwhitelist[i].trim().replace(/[.]/g,",")
    if(acc === '') continue;
    firebase.database().ref(config.account+'/whitelist/'+acc).set(da, function(error){console.log(error);});
    whi[acc] = da;
  }
  //console.log("whi");
  //console.log(whi);  
  //firebase.database().ref(config.account+'/whitelist').set(whi);
  //firebase.database().ref(config.account+'/dele').set("juli-an");
  console.log("created");
}

function renameDele2Delegators(){
  firebase.database().ref(config.account+'/dele').once('value').then(function(data){
    firebase.database().ref(config.account+'/delegators').set(data.val());
    console.log("rename done");
  });
}

function delegatorsFromArrayToObject(){
  firebase.database().ref(config.account+'/delegators').once('value').then(function(data){
    delegators = data.val();
    dele = {};
    for(var i=0;i<delegators.length;i++){
      d = {
        vesting_shares:delegators[i].vesting_shares,        
        sbd_reward_percentage:100,
        curation_reward_percentage:100
      }
      if(delegators[i].new_vesting_shares) d.new_vesting_shares = delegators[i].new_vesting_shares;
      dele[delegators[i].delegator] = d;
    }
    firebase.database().ref(config.account+'/dele').set(dele);
    console.log("dele is done");
  });
}



function copyKey(key,from,to){
  firebase.database().ref(from+'/'+key).once('value').then(function(snap){
    firebase.database().ref(to+'/'+key).set(snap.val());
  });
}


function copyJSON(){
  keys = ['whitelist','delegators','admins','debt','globalPropertiesSteem','state'];

  keys.forEach(function(key){
    firebase.database().ref(key).once('value').then(function(snap) {
      firebase.database().ref(config.account+'/'+key).set(snap.val());
    });  
  });
}