var firebase = require('firebase-admin');
var config = require('./config.js')
const delegations = require("./ocdb_delegations.json");

firebase.initializeApp({
  credential: firebase.credential.cert(config.firebaseCredentials),
  databaseURL: 'https://steem-bid-bot.firebaseio.com/'
});

var ref = firebase.database().ref(config.account);

function printDelegator(d) {
  const delegator = d.delegator + " ".repeat(20 - d.delegator.length);
  const amount = " ".repeat(18 - d.vesting_shares.amount.length) + (parseInt(d.vesting_shares.amount)/1000000).toFixed(6) + " VESTS";
  console.log(`${delegator}${amount}`);
}

(async () => {
  console.log(`There are ${delegations.length} delegators:`);

  console.log("Sorted by delegation")
  delegations.sort((a,b) => parseInt(b.vesting_shares.amount) - parseInt(a.vesting_shares.amount));
  delegations.forEach(printDelegator);
  console.log(`
  
  
  `)
  console.log("Sorted by name")
  delegations.sort((a,b) => a.delegator.localeCompare(b.delegator));
  delegations.forEach(printDelegator);

  for(var i in delegations) {
    if(i > 0 && delegations[i].delegator === delegations[i-1].delegator) console.log("repeated "+delegations[i].delegator)
  }

  const delegators = {};
  delegations.forEach(d => {
    const delegator = d.delegator.replace(/[.]/g,",");
    delegators[delegator] = {
      curation_reward_percentage: 100,
      donation_sbd: 0,
      donation_sp: 0,
      donation_steem: 0,
      sbd_reward_percentage: 100,
      vesting_shares: (parseInt(d.vesting_shares.amount)/1000000).toFixed(6) + " VESTS",
    };
    switch(delegator) {
      case "thejohalfiles":
        delegators[delegator].send_to = "singhcapital";
        break;
      case "blocktrades":
        delegators[delegator].send_to = "alpha";
        break;
      default:
        break;
    }
  });

  // check accounts with send_to
  /* ref.child("delegators").once("value", function(snapshot) {
    const fd = snapshot.val();
    for(var i in fd) 
      if(fd[i].send_to) console.log(fd[i]);
  }); */

  // update delegations in firebase
  /* ref.child('delegators').set(delegators)
  console.log("delegators updated in firebase"); */
})()