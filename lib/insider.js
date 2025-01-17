'use strict';

/**
 * @author      hustcer
 * @license     MIT
 * @copyright   TraceInvest.com
 * @create      07/08/2015
 * @example
 *      star -i 002065    // 查询东华软件高管交易信息
 *      star -i 300036    // 查询超图软件高管交易信息
 *      star -i 000060    // 查询中金岭南高管交易信息
 *      star -i 603993    // 查询洛阳钼业高管交易信息
 *      star -i 000768,002456,600118,601777,300036,000902 --span 3m
 * @see
 *      深中小板高管持股变动: http://www.szse.cn/main/sme/jgxxgk/djggfbd/
 *      深创业板高管持股变动: http://www.szse.cn/main/chinext/jgxxgk/djggfbd/
 *      深圳主板高管持股变动: http://www.szse.cn/main/mainboard/jgxxgk/djggfbd/
 *      上海主板高管持股变动: http://www.sse.com.cn/disclosure/listedinfo/credibility/change/
 */

let _       = require('lodash'),
    moment  = require('moment'),
    printf  = require('printf'),
    cheerio = require('cheerio'),
    numeral = require('numeral'),
    cmd     = require('commander');


let start   = new Date().getTime();
let conf    = require('./conf.js').conf;
let Iconv   = require('iconv').Iconv;
let iconv   = new Iconv('GBK', 'UTF-8//TRANSLIT//IGNORE');
let request = require('request');
let Common  = require('./common.js').Common;

let from = null;
let to   = null;
let ft   = conf.fmt;

numeral.language('chs', conf.numeral);
// switch between languages
numeral.language('chs');
numeral.defaultFormat(ft.common);

/**
 * 各类提示信息
 * @type {Object}
 */
const MSG = {
    NO_TRADING    : '在当前时间范围内无董监高交易记录！',
    PARAM_ERROR   : '参数输入错误，请检查后重试！',
    INPUT_ERROR   : '输入错误，当前只支持通过单只证券代码查询，请重新输入！',
    REQUEST_ERROR : '数据请求错误，请重试！错误信息：\n',
    SYSTEM_BUSY   : '系统正忙，请稍后再试!\n'
};

/**
 * 计算董监高交易信息汇总摘要数据
 * @param  {Array} tradings  Trading array.
 * @return {Object}          Trading summary.
 */
let calcSummary = function(tradings){
    if(tradings.length === 0){ return null; }

    let summary = {
        buyShare   : 0,
        sellShare  : 0,
        buyPrice   : 0,
        sellPrice  : 0,
        buyCost    : 0,
        sellProfit : 0,
        netBuyShare: 0,
        netBuyCost : 0
    };
    _.each(tradings, t => {
        if(t.CHANGE_NUM > 0){
            summary.buyShare += t.CHANGE_NUM;
            summary.buyCost  += t.CHANGE_NUM*t.CURRENT_AVG_PRICE;
        }else{
            summary.sellShare  += Math.abs(t.CHANGE_NUM);
            summary.sellProfit += Math.abs(t.CHANGE_NUM*t.CURRENT_AVG_PRICE);
        }
    });

    summary.buyPrice    = (summary.buyShare  !== 0) ? summary.buyCost/summary.buyShare     :'N/A';
    summary.sellPrice   = (summary.sellShare !== 0) ? summary.sellProfit/summary.sellShare :'N/A';
    summary.netBuyShare = summary.buyShare - summary.sellShare;
    summary.netBuyCost  = summary.buyCost  - summary.sellProfit;

    summary.buyShare    = numeral(summary.buyShare).format();
    summary.sellShare   = numeral(summary.sellShare).format();
    summary.netBuyShare = numeral(summary.netBuyShare).format();
    summary.buyPrice    = numeral(summary.buyPrice).format(ft.flot);
    summary.sellPrice   = numeral(summary.sellPrice).format(ft.flot);
    summary.buyCost     = numeral(summary.buyCost).format(ft.money);
    summary.netBuyCost  = numeral(summary.netBuyCost).format(ft.money);
    summary.sellProfit  = numeral(summary.sellProfit).format(ft.money);

    return summary;
};

/**
 * Get trading data from html segment.
 * @param  {String} html Html string
 * @return {Array}      Trading records.
 */
let getTradings = function(html){
    let data = [];
    let $    = cheerio.load(html, {decodeEntities:false});
    let $td  = null;
    $('tr.cls-data-tr').each(function(){
        $td = $('td', this);
        data.push({
            COMPANY_CODE      : $td.eq(0).html(),
            COMPANY_ABBR      : $td.eq(1).html(),
            NAME              : $td.eq(2).html(),
            CHANGE_DATE       : $td.eq(3).html(),
            CHANGE_NUM        :+$td.eq(4).html(),
            CURRENT_AVG_PRICE :+$td.eq(5).html(),
            CHANGE_REASON     : $td.eq(6).html(),
            _RATIO            :+$td.eq(7).html(),
            HOLDSTOCK_NUM     :+$td.eq(8).html(),
            _INSIDER          : $td.eq(9).html(),
            DUTY              : $td.eq(10).html(),
            _RELATION         : $td.eq(11).html()
        });
    });
    return data;
};

/**
 * Display ShenZhen market insider trading records.
 * @param {String} market     Market type should be 'sz' or 'sh'
 * @param  {Array} tradings   Insider trading records array
 */
let displayTradings = function(market, tradings){
    if(market === 'sz'){
        console.log((printf(conf.insider.sz.TH, '证券简称', '代码', '交易人', '变动股数', '均价',
                                                '结存股数', '变动日期', '变动原因', '高管姓名', '关系',
                                                '职务') + ' '.repeat(7)).underline);
        _.each(tradings, t => {
            t.COMPANY_ABBR  = t.COMPANY_ABBR.replace(/ /g, '');
            t.COMPANY_ABBR  = t.COMPANY_ABBR.padOutput(8, 'left');
            t.NAME          = t.NAME.padOutput(6, 'left');
            t.CHANGE_NUM    = numeral(t.CHANGE_NUM).format();
            t.HOLDSTOCK_NUM = _.isNaN(t.HOLDSTOCK_NUM)? '-' : numeral(t.HOLDSTOCK_NUM).format();
            t.CHANGE_DATE   = t.CHANGE_DATE.replace(/\-/g, '/');
            t._INSIDER      = t._INSIDER.padOutput(6, 'left');
            console.log(printf(conf.insider.sz.TD, t.COMPANY_ABBR, t.COMPANY_CODE, t.NAME,
                               t.CHANGE_NUM, t.CURRENT_AVG_PRICE, t.HOLDSTOCK_NUM, t.CHANGE_DATE,
                               t.CHANGE_REASON, t._INSIDER, t._RELATION, t.DUTY));
        });
        return false;
    }

    console.log((printf(conf.insider.sh.TH, '证券简称', '代码', '交易人', '变动股数', '均价',
                                            '结存股数', '变动日期', '填报日期', '变动原因', '职务') +
                                            ' '.repeat(10)).underline);
    _.each(tradings, t => {
        t.COMPANY_ABBR  = t.COMPANY_ABBR.padOutput(8, 'left');
        t.NAME          = t.NAME.replace(/ /g, '');
        t.NAME          = t.NAME.padOutput(6, 'left');
        t.CHANGE_NUM    = numeral(t.CHANGE_NUM).format();
        t.HOLDSTOCK_NUM = numeral(t.HOLDSTOCK_NUM).format();
        t.CHANGE_DATE   = t.CHANGE_DATE.replace(/\-/g, '/');
        t.FORM_DATE     = t.FORM_DATE.replace(/\-/g, '/');
        console.log(printf(conf.insider.sh.TD, t.COMPANY_ABBR, t.COMPANY_CODE, t.NAME,
                           t.CHANGE_NUM, t.CURRENT_AVG_PRICE, t.HOLDSTOCK_NUM, t.CHANGE_DATE,
                           t.FORM_DATE, t.CHANGE_REASON, t.DUTY));
    });
};

/**
 * Display insider trading details of specified symbol code
 * @param  {String} code     symbol code
 * @param  {Object} summary  Trading summary
 * @param  {Array} tradings  Trading records
 */
let displayDetail = function(code, summary, tradings){
    // console.log(JSON.stringify(summary, null, 4));
    // console.log(JSON.stringify(tradings, null, 4));
    if(from && to){
        console.log(('\n董监高近期交易信息，证券代码：'+ code + ', 从: ' + from + ', 到: '+ to + ' '.repeat(50)).em.underline);
    }else{
        console.log(('\n董监高近期交易信息，证券代码：'+ code + ' '.repeat(80)).em.underline);
    }
    if(!summary){
        console.log(MSG.NO_TRADING.info);
        return false;
    }
    console.log('净增持股数：' , summary.netBuyShare.padOutput(18, 'right', true),
                '净增持额：'  , summary.netBuyCost.padOutput(20, 'right', true));
    console.log('总增持股数：' , summary.buyShare.padOutput(18, 'right', true),
                '增持均价：'  , summary.buyPrice.padOutput(20, 'right', true),
                '总增持额：'  , summary.buyCost.padOutput(15, 'right', true));
    console.log('总减持股数：' , summary.sellShare.padOutput(18, 'right', true),
                '减持均价：'  , summary.sellPrice.padOutput(20, 'right', true),
                '总减持额：'  , summary.sellProfit.padOutput(15, 'right', true));

    console.log(('\n交易详情:'+' '.repeat(109)).header.underline);

    let market = conf.market[code.substr(0,3)];
    displayTradings(market, tradings);
};

/**
 * Get query options from code and cmd input
 * @param  {String} code Symbol code
 * @return {Object}      Query options
 */
let getQueryOption = function(code){

    let market = conf.market[code.substr(0,3)];
    let option = conf.insider[market];
    let spanM  = cmd.span || option.span;
    option.qs[option.codeKey] = code;
    if(market === 'sz'){
        option.qs.CATALOGID   = option.catalog[code.substr(0,3)];
        option.qs.tab1PAGENUM = cmd.page || 1;
    }
    if(spanM){
        let span = parseInt(spanM);
        span = span > 24 ? 24: span;
        span = span < 1 ?   1: span;
        option.qs[option.endKey]   = moment().format(ft.outDate);
        option.qs[option.beginKey] = moment().subtract(span, 'month').format(ft.outDate);
    }
    if(cmd.from){
        if(moment(cmd.from, ft.inDate).isValid()){
            option.qs[option.beginKey] = moment(cmd.from, ft.inDate).format(ft.outDate);
        }else{
            console.error(MSG.PARAM_ERROR.em);
            return false;
        }
    }
    if(cmd.to){
        if(moment(cmd.to, ft.inDate).isValid()){
            option.qs[option.endKey] = moment(cmd.to, ft.inDate).format(ft.outDate);
        }else{
            console.error(MSG.PARAM_ERROR.em);
            return false;
        }
    }
    from = moment(option.qs[option.beginKey]).format(ft.inDate);
    to   = moment(option.qs[option.endKey]).format(ft.inDate);
    // console.log(JSON.stringify(option.qs, null, 4));
    return option;
};

/**
 * Query insider tradings from the specified symbol code
 * @param {String}      code    Symbol code of specified company.
 * @param {Function}    cb      Callback function
 */
let queryInsider = function(code, cb) {
    if(!Number.isInteger(Number(code))){
        console.error(MSG.INPUT_ERROR);
        return false;
    }
    let market = conf.market[code.substr(0,3)];
    let option = getQueryOption(code);

    request(option, function(e, r, body){
        let tradings = [];
        if(e || (r && r.statusCode !== 200)){
            if(r && r.statusCode === 408){
                console.error(MSG.SYSTEM_BUSY.error);
                console.error(JSON.stringify({statusCode: r.statusCode,
                                              headers: r.request.headers}, null, 4).error);
                return false;
            }
            console.error(MSG.REQUEST_ERROR, printf(JSON.stringify(e||r, null, 4).error));
            return false;
        }
        if(market === 'sz'){
            let html = iconv.convert(body).toString();
            tradings = getTradings(html);

        }else{
            tradings   = Common.parseJsonP(body).result;
            _.each(tradings, t => {
                t.CHANGE_NUM        = +t.CHANGE_NUM;
                t.HOLDSTOCK_NUM     = +t.HOLDSTOCK_NUM;
                // t.CURRENT_AVG_PRICE could be null, check symbol code: 600056 frome 2006/06/01
                t.CURRENT_AVG_PRICE = +t.CURRENT_AVG_PRICE || 0;
                return t;
            });
        }
        let summary  = calcSummary(tradings);
        displayDetail(code, summary, tradings);

        let end      = new Date().getTime();
        console.log(' '.repeat(118).underline.yellow);

        console.log(' '.repeat(35) + 'Done!'.header, '操作耗时:', ((end - start) + ' ms').em,
                    ', 总交易记录：' + (tradings.length+'').em,
                    ' '.repeat(15),'By TraceInvest.com\n' );

        if(_.isFunction(cb)){ cb(); }
    });
};

exports.Insider = {
    queryInsider : queryInsider
};
