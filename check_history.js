const {Client} = require('dsteem')
var fs = require("fs")

const client = new Client('https://api.steemit.com')
const bot = 'ocdb'
const target_time = new Date('2019-05-18T00:00:00Z')

async function main() {
  var last = await client.database.call('get_account_history',[bot,-1,1])
  var old_timestamp = new Date(last[0][1].timestamp + 'Z')
  var sequence = last[0][0]
  console.log(`Last transaction number: ${sequence}`)
  var delegators = []
  var total_repeated = 0
  var total_amount_sbd = 0
  var total_amount_steem = 0
  var total_same_trx_ids = 0

  while(old_timestamp > target_time){
    var history = await client.database.call('get_account_history',[bot,sequence,1000])
    sequence = history[0][0] - 1
    history = history.reverse()
    var round_amount_sbd = 0
    var round_amount_steem = 0
    for(var i in history){
      var h = history[i]
      var timestamp = h[1].timestamp
      var block = h[1].block
      var trx_id = h[1].trx_id
      var op_name = h[1].op[0]
      var op_data = h[1].op[1]
      if(op_name === 'transfer' && op_data.from === bot && op_data.memo.substring(0,1) === '#') {
        var date = timestamp.slice(0,-9)
        var currency = op_data.amount.split(' ')[1]
        var amount = parseFloat(op_data.amount)
        var payment = {
          date,
          currency,
          amounts: [amount],
          blocks: [block],
          trx_ids: [trx_id]
        }

        //payment to a delegator
        var delegator = delegators.find( (d)=>{ return d.name === op_data.to })
        if(!delegator){
          delegators.push({
            name: op_data.to,
            payments: [ payment ]
          })
        }else{
          var same_trx_id = delegator.payments.findIndex( (p)=>{
            var id = p.trx_ids.findIndex( (t)=>{ return t === trx_id })
            return id >= 0 && p.currency === currency
          })
          if(same_trx_id >= 0){
            total_same_trx_ids++
            continue
          }

          var repeated_payment = delegator.payments.find( (p)=>{ return p.date === date && p.currency === currency })
          if(repeated_payment){
            repeated_payment.amounts.push(amount)
            repeated_payment.blocks.push(block)
            repeated_payment.trx_ids.push(trx_id)
            total_repeated++
            if(currency === 'STEEM'){
              total_amount_steem += amount
              round_amount_steem += amount
            }else if(currency === 'SBD'){
              total_amount_sbd += amount
              round_amount_sbd += amount
            }else{
              console.log('FATAL ERROR: SEE CURRENCY')
            }
          }else{
            delegator.payments.push(payment)
          }
        }
      }
      var date_timestamp = new Date(timestamp+'Z')
      if( old_timestamp > date_timestamp ) old_timestamp = date_timestamp
    }
    console.log(`${old_timestamp.toUTCString()} ... repeated ${total_repeated} ... ${round_amount_steem.toFixed(3)} STEEM ... ${round_amount_sbd.toFixed(3)} SBD`)
  }
  console.log(`total repeated: ${total_repeated}`)
  console.log(`total same trx_id: ${total_same_trx_ids}`)
  console.log(`total STEEM: ${total_amount_steem}`)
  console.log(`total SBD:   ${total_amount_sbd}`)
  
  var total_repeated2 = 0
  delegators.forEach( (d)=>{
    d.payments.forEach( (p)=>{
      total_repeated2 += p.amounts.length - 1
    })

    //remove normal payments
    while(true){
      var id_no_repeated = d.payments.findIndex( (p)=>{ return p.amounts.length === 1 })
      if(id_no_repeated < 0) break
      d.payments.splice(id_no_repeated, 1)
    }
  })

  //remove delegators with normal payments
  while(true){
    var id = delegators.findIndex( (d)=>{ return d.payments.length == 0 })
    if(id < 0) break
    delegators.splice(id, 1)
  }
  console.log(`total repeated 2: ${total_repeated2}`)

  fs.writeFile('repeated_payments.json', JSON.stringify(delegators, null, 2), function (err) {
    if (err)
      console.log(err);
  });
  
  delegators.forEach( (d)=>{
    var message = `@${d.name}`
    d.payments.forEach( (p)=>{
      message += '   ' + (p.amounts[0] * (p.amounts.length - 1)).toFixed(3) + ' ' + p.currency
    })
    console.log(message)
  })
}

main().catch(console.error)
