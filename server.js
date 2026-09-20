'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowLabel = () => new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
const randomId = () => crypto.randomBytes(12).toString('hex');
const roomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  do {
    out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(out));
  return out;
};
const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const baseCards = [
  {id:1,name:'突然ですが、あなたの負けです',type:'通常',text:'プレイヤー1人を選ぶ。そのプレイヤーを脱落させる。',copies:3,effect:'eliminateTarget',attack:true},
  {id:2,name:'いや、お前が負けろよ',type:'割込',text:'他プレイヤーの効果で自分が脱落する時、その脱落を効果の使用者へ返す。',copies:3,interrupt:'reflectElimination'},
  {id:3,name:'なんで俺だけ！？',type:'通常',text:'手札が最も多い生存者全員を脱落させる。同数なら全員。',copies:3,effect:'mostHandOut',attack:true},
  {id:4,name:'全員そこに正座',type:'通常',text:'全員の手札を確認し、カード名に「勝」が入るカードを持つプレイヤー全員を脱落させる。',copies:3,effect:'revealWinWordOut',attack:true},
  {id:5,name:'多数決を始めます',type:'通常',text:'生存者全員が脱落させたい相手へ投票する。最多票が脱落。同票なら最多票全員。',copies:3,effect:'vote',attack:true},
  {id:6,name:'民主主義って怖いね',type:'割込',text:'《多数決を始めます》の結果確定後に使用。最多票ではなく最少票のプレイヤー全員を脱落対象にする。',copies:3,interrupt:'reverseVote'},
  {id:7,name:'ちょっと待った！',type:'割込',text:'他プレイヤーが通常・継続・特殊カードを使用した直後、そのカードを無効にする。',copies:3,interrupt:'cancelCard'},
  {id:8,name:'ちょっと待たない！',type:'割込',text:'《ちょっと待った！》に対して使用。それを無効にし、元のカードを予定通り発動する。',copies:3,interrupt:'uncancelCard'},
  {id:9,name:'空気読めよ',type:'通常',text:'現在ポイントが最も高い生存者全員を脱落させる。同率なら全員。',copies:3,effect:'topPointOut',attack:true},
  {id:10,name:'最下位救済キャンペーン',type:'通常',text:'最少ポイントの生存者は手札が5枚になるまで引く。引いたカードがすべて攻撃カードなら、そのプレイヤーは脱落する。',copies:3,effect:'bottomDraw'},
  {id:11,name:'今から本気出す',type:'通常',text:'残りの手札をすべて捨てて3枚引く。その3枚すべてのカード名に「！」が入っていれば即座にラウンド勝利。',copies:3,effect:'allDiscardDraw3ExclaimWin'},
  {id:12,name:'知らんけど',type:'通常',text:'直前に解決した通常・継続・特殊カードの効果をもう一度発動する。対象が必要ならランダム。',copies:3,effect:'repeatLastRandom'},
  {id:13,name:'巻き添え',type:'割込',text:'自分が脱落した直後に使用。生存者1人を選び、そのプレイヤーも脱落させる。',copies:3,interrupt:'revenge'},
  {id:14,name:'お前とは仲良くなれそうだ',type:'通常',text:'他プレイヤー1人を選び、自分と運命共同体になる。片方が脱落したら、もう片方も脱落する。',copies:3,effect:'soulLink'},
  {id:15,name:'友情って素晴らしい！',type:'通常',text:'運命共同体を1組選ぶ。その2人以外の生存者からランダムで1人を脱落させる。',copies:3,effect:'friendshipRandomOut',attack:true},
  {id:16,name:'勝ったと思った？',type:'割込',text:'カード効果によるラウンド勝利が発生する直前に使用。その勝利を無効にし、勝者予定者の手札をすべて捨てる。',copies:3,interrupt:'cancelSpecialWin'},
  {id:17,name:'いや勝ってるから',type:'割込',text:'自分のカード効果による勝利に《勝ったと思った？》を使われた時に使用。それを無効にし、そのまま勝利する。',copies:3,interrupt:'restoreSpecialWin'},
  {id:18,name:'神は言っている――まだ死ぬ時ではないと',type:'割込',text:'自分が脱落する直前に使用。その脱落を無効にする。',copies:3,interrupt:'preventElimination'},
  {id:19,name:'神「やっぱ死んで」',type:'割込',text:'《神は言っている――まだ死ぬ時ではないと》使用時に使用。その無効化を無効にする。',copies:3,interrupt:'cancelPrevention'},
  {id:20,name:'THE クールソウル',type:'特殊',text:'このカードが自分の最後の手札なら使用できる。使用すると即座にラウンド勝利する。',copies:3,effect:'coolSoulWin'},

  {id:21,name:'引いたね？',type:'強制',text:'引いた瞬間に公開する。何もしなければ、そのプレイヤーは脱落する。',copies:3,effect:'drawDeath',auto:true,attack:true},
  {id:22,name:'セーフ！',type:'割込',text:'自分が《引いたね？》を引いた時に使用。その脱落を無効にする。',copies:3,interrupt:'safeDrawDeath'},
  {id:23,name:'セーフじゃないよ',type:'割込',text:'誰かが《セーフ！》を使った時に使用。《セーフ！》を無効にする。',copies:3,interrupt:'cancelSafeDrawDeath'},
  {id:24,name:'何も起きません',type:'通常',text:'本当に何も起きない。たぶん。',copies:3,effect:'nothing'},
  {id:25,name:'何も起きないと思った？',type:'割込',text:'《何も起きません》の直後に使用。使用者以外の生存者は手札を1枚捨てる。捨てられないプレイヤーは脱落する。',copies:3,interrupt:'afterNothing'},
  {id:26,name:'事故です',type:'通常',text:'ランダムな生存者1人が脱落する。自分も対象。',copies:3,effect:'randomOut',attack:true},
  {id:27,name:'大事故です',type:'通常',text:'ランダムな生存者2人が脱落する。',copies:3,effect:'doubleRandomOut',attack:true},
  {id:28,name:'責任者を呼べ！',type:'割込',text:'他プレイヤーのカード効果が解決した直後に使用。そのカードの使用者を脱落させる。',copies:3,interrupt:'callManager'},
  {id:29,name:'私が責任者です',type:'割込',text:'自分が《責任者を呼べ！》の対象になった時に使用。代わりに《責任者を呼べ！》の使用者を脱落させる。',copies:3,interrupt:'reverseManager'},
  {id:30,name:'そんなルールあった？',type:'割込',text:'他プレイヤーがカードを使用した直後に使用。そのカードを無効にし、同名カードをこのラウンド中使用禁止にする。',copies:3,interrupt:'banCancel'},
  {id:31,name:'今作った',type:'割込',text:'《そんなルールあった？》に対して使用。それを無効にし、元のカードを予定通り発動する。',copies:3,interrupt:'unbanCancel'},
  {id:32,name:'手札見せて♡',type:'通常',text:'他プレイヤー1人の手札を見る。攻撃カードを持っていたら、その中から1枚を奪う。',copies:3,effect:'peekAndSteal'},
  {id:33,name:'見たな？',type:'割込',text:'自分の手札を見られた直後に使用。覗いたプレイヤーの手札を全員に公開する。',copies:3,interrupt:'counterPeek'},
  {id:34,name:'目が合ったね',type:'TRAP',text:'プレイヤー1人を指名して視線確認UIを表示する。危険な確認を押したら脱落。',copies:3,effect:'trapEye'},
  {id:35,name:'今しゃべった？',type:'割込',text:'誰かがゲーム内チャットで発言した直後に使用。その人は手札を1枚捨てる。捨てられなければ脱落。',copies:3,interrupt:'afterChat'},
  {id:36,name:'静粛に！',type:'継続',text:'次の自分のターン開始まで、チャットで発言したプレイヤーを脱落させる。',copies:3,effect:'silence'},
  {id:37,name:'いやゲームできないだろ',type:'割込',text:'《静粛に！》の発動時、または効果中に使用。《静粛に！》を解除する。',copies:3,interrupt:'breakSilence'},
  {id:38,name:'席替えしまーす',type:'通常',text:'全員の手札を左隣へ渡す。',copies:3,effect:'rotateHands'},
  {id:39,name:'逆だったわ',type:'割込',text:'《席替えしまーす》に対して使用。手札を左ではなく右隣へ渡す。',copies:3,interrupt:'reverseSeat'},
  {id:40,name:'返して',type:'割込',text:'自分の手札が他人へ渡される直前に使用。移動後、その中から1枚を取り戻し、受け取った相手からさらにランダム1枚を受け取る。',copies:3,interrupt:'takeBack'},
  {id:41,name:'それ俺の',type:'割込',text:'他プレイヤーが通常ドローした直後に使用。その引いたカードを奪う。',copies:3,interrupt:'stealDraw'},
  {id:42,name:'欲張りさんね',type:'割込',text:'誰かが他人のカードを奪った直後に使用。そのプレイヤーから最大2枚を奪う。',copies:3,interrupt:'punishSteal'},
  {id:43,name:'山札なんて信用できない',type:'通常',text:'山札の上から3枚を見て、好きな順番に並べ直す。',copies:3,effect:'reorderTop3'},
  {id:44,name:'見せろ',type:'割込',text:'《山札なんて信用できない》使用時に使用。見た3枚を全員に公開させる。',copies:3,interrupt:'revealTop3'},
  {id:45,name:'未来は変えられる',type:'通常',text:'山札の一番上を捨てる。',copies:3,effect:'discardTop'},
  {id:46,name:'未来は変えられない',type:'割込',text:'《未来は変えられる》に対して使用。その捨て札化を無効にし、使用者に山札の一番上を引かせる。',copies:3,interrupt:'forceFutureDraw'},
  {id:47,name:'今日の主役',type:'継続',text:'次の自分のターン開始まで、単体カードの対象を選ぶ時、可能なら自分を選ばなければならない。',copies:3,effect:'mainCharacter'},
  {id:48,name:'空気になりたい',type:'継続',text:'次の自分のターンまで、単体カードの対象にならない。',copies:3,effect:'untargetable'},
  {id:49,name:'お前いたの？',type:'通常',text:'《空気になりたい》状態のプレイヤー1人を選び、その効果を無視して脱落させる。',copies:3,effect:'findInvisible',attack:true},
  {id:50,name:'ちょっとトイレ',type:'特殊',text:'次の自分のターン開始までゲーム外へ退避する。退避中はカードの対象にならない。',copies:3,effect:'toilet'},
  {id:51,name:'戻ってこなくていいよ',type:'割込',text:'《ちょっとトイレ》からプレイヤーが戻る瞬間に使用。そのプレイヤーを脱落させる。',copies:3,interrupt:'denyReturn'},
  {id:52,name:'遺言',type:'割込',text:'自分が脱落した直後に使用。残り手札をすべて生存者1人へ渡す。',copies:3,interrupt:'lastWill'},
  {id:53,name:'呪いの遺産',type:'強制',text:'他プレイヤーからこのカードを受け取った瞬間、受け取ったプレイヤーは脱落する。',copies:3,effect:'cursedInheritance',autoTransfer:true,attack:true},
  {id:54,name:'プレゼント！',type:'通常',text:'自分の残り手札から1枚選び、他プレイヤー1人へ裏向きで渡す。相手は受け取らなければならない。',copies:3,effect:'gift'},
  {id:55,name:'受取拒否',type:'割込',text:'他プレイヤーからカードを渡される直前に使用。そのカードを送り返す。',copies:3,interrupt:'rejectGift'},
  {id:56,name:'返品不可です',type:'割込',text:'《受取拒否》に対して使用。それを無効にし、カードを予定通り受け取らせる。',copies:3,interrupt:'noReturns'},
  {id:57,name:'全員仲良く死のう？',type:'通常',text:'生存者全員を脱落させる。',copies:3,effect:'allOut',attack:true},
  {id:58,name:'それ勝者いなくない？',type:'割込',text:'全員脱落効果が発生する直前に使用。自分だけその効果を受けずに生き残る。',copies:3,interrupt:'surviveAll'},
  {id:59,name:'最後に笑うのは俺だ',type:'通常',text:'生存者が自分を含めて2人だけなら使用可能。コイントスし、負けた方が脱落する。',copies:3,effect:'finalCoin',attack:true},
  {id:60,name:'コインなんてねぇよ',type:'割込',text:'コイントスを行うカードが使われた時に使用。そのカードの使用者を脱落させ、コイントスを中止する。',copies:3,interrupt:'noCoin'},
  {id:69,name:'今日から逆回りです',type:'継続',text:'ターン進行方向を反転する。以後、再び反転されるまでその向きで進む。',copies:3,effect:'reverse'},
  {id:70,name:'やっぱ元に戻します',type:'継続',text:'現在のターン進行方向をもう一度反転する。結果として元に戻ることもある。',copies:3,effect:'reverse'},
  {id:71,name:'手札なんて2枚で十分',type:'継続',text:'手札上限を2枚にする。超過分はランダムで捨てる。',copies:3,effect:'limit2'},
  {id:72,name:'いっぱい持ってていいよ',type:'継続',text:'手札上限を撤廃する。',copies:3,effect:'noLimit'},
  {id:73,name:'カード引くの禁止！',type:'継続',text:'次の自分のターン開始まで、誰もカードを引けない。',copies:3,effect:'noDraw'},
  {id:74,name:'いや引けよ',type:'割込',text:'《カード引くの禁止！》の発動時、またはドローが禁止されている時に使用。禁止を解除し、生存中の全員が1枚引く。',copies:3,interrupt:'breakNoDraw'},
  {id:75,name:'1ターンに1枚とは言ってない',type:'通常',text:'残りの手札から1枚を捨て、その後2枚引く。カード使用回数は増えない。ゲームの「1ターン1枚」ルール自体は破らない。',copies:3,effect:'cheatDraw'},
  {id:76,name:'言ってるよ',type:'割込',text:'《1ターンに1枚とは言ってない》に対して使用。その効果を無効にし、使用者は残り手札から1枚捨てる。',copies:3,interrupt:'callOutCheat'},
  {id:77,name:'平和条約',type:'継続',text:'次の自分のターン開始まで、脱落を直接起こすカードを使用できない。',copies:3,effect:'peace'},
  {id:78,name:'条約破棄',type:'通常',text:'場の《平和条約》をすべて解除し、その後プレイヤー1人を選んで脱落させる。',copies:3,effect:'breakPeace',attack:true},
  {id:79,name:'革命だ！',type:'通常',text:'全プレイヤーのポイントを最高点と最低点の間で反転させる。高得点ほど低得点に、低得点ほど高得点になる。',copies:3,effect:'revolution'},
  {id:80,name:'革命失敗',type:'割込',text:'《革命だ！》に対して使用。革命を無効にし、革命を起こそうとしたプレイヤーは残り手札をすべて捨てる。',copies:3,interrupt:'stopRevolution'},
  {id:81,name:'数字は禁止です',type:'継続',text:'次の自分のターン開始まで、チャットに数字を含めたプレイヤーは手札を1枚捨てる。',copies:3,effect:'banNumbers'},
  {id:82,name:'カタカナ禁止です',type:'継続',text:'次の自分のターン開始まで、チャットにカタカナを含めたプレイヤーは1枚引く。',copies:3,effect:'banKatakana'},
  {id:83,name:'名前で呼んで',type:'継続',text:'次の自分のターン開始まで、チャットで「お前・君・あなた・あんた・こいつ・そいつ・あいつ」を使うなら、誰かのプレイヤー名も含めなければならない。違反したら手札を1枚捨てる。',copies:3,effect:'nameCalling'},
  {id:84,name:'敬語でお願いします',type:'継続',text:'次の自分のターン開始まで、チャットは「です・ます」などの丁寧語で終えなければならない。違反したら1枚引く。',copies:3,effect:'politeSpeech'},
  {id:85,name:'黙ってゲームしろ',type:'継続',text:'ラウンド終了か解除まで、チャットで発言するたびにそのプレイヤーは1枚引く。',copies:3,effect:'chatDraw'},
  {id:86,name:'喋らないとゲームできないだろ！',type:'割込',text:'《黙ってゲームしろ》の発動時、またはその効果中に使用。《黙ってゲームしろ》をすべて解除する。',copies:3,interrupt:'breakChatDraw'},
  {id:87,name:'時計回りってどっち？',type:'通常',text:'生存中の全員が「←」か「→」を選ぶ。少数派は1枚引く。同数なら全員2枚引く。全員同じなら何も起きない。',copies:3,effect:'leftRightVote'},
  {id:88,name:'席順変更！',type:'通常',text:'全員の手札を集めてシャッフルし、できるだけ均等に再配布する。',copies:3,effect:'redistribute'},
  {id:89,name:'もう誰のカードかわかんねぇよ',type:'通常',text:'捨て札をすべて山札へ戻し、山札をシャッフルする。',copies:3,effect:'recycleAllDiscard'},
  {id:90,name:'ゴミ箱漁り',type:'通常',text:'このカード自身を除く捨て札から好きなカード1枚を選び、手札に戻す。',copies:3,effect:'recycleChoice'},
  {id:91,name:'それ捨てたやつだから',type:'割込',text:'誰かが捨て札からカードを回収した直後に使用。その回収カードを奪う。',copies:3,interrupt:'stealRecovered'},
  {id:92,name:'突然の最終局面',type:'通常',text:'山札が10枚より多いなら、10枚になるまで上から捨て札へ送る。',copies:3,effect:'deckToTen'},
  {id:93,name:'延長戦入りまーす',type:'通常',text:'捨て札をすべて山札へ戻し、シャッフルする。',copies:3,effect:'extendGame'},
  {id:94,name:'はい、ここから本番',type:'通常',text:'ゲーム内にいる生存者全員の手札を捨て、それぞれ5枚引き直す。',copies:3,effect:'resetHands'},
  {id:95,name:'チュートリアル終了',type:'通常',text:'自分の現在ポイントと同じ枚数だけカードを引く。',copies:3,effect:'drawByPoints'},
  {id:96,name:'強い奴を殴れ',type:'継続',text:'ラウンド終了まで、単体の脱落カードで対象を選ぶ時、可能なら現在ポイント最多のプレイヤーを選ばなければならない。',copies:3,effect:'focusLeader'},
  {id:97,name:'弱い者いじめ禁止',type:'継続',text:'ラウンド終了か解除まで、現在ポイント最少のプレイヤーはカード効果による脱落から守られる。',copies:3,effect:'protectLast'},
  {id:98,name:'世の中そんな甘くない',type:'通常',text:'場の《弱い者いじめ禁止》をすべて解除する。',copies:3,effect:'removeProtectLast'},
  {id:112,name:'このカードは安全です',type:'TRAP',text:'安全確認画面を表示する。詳しい説明を読んだら……？',copies:3,effect:'trapSafe'},
  {id:113,name:'右を見ろ',type:'TRAP',text:'右側に気になるボタンが出る。押さなければいいだけ。',copies:3,effect:'trapRight'}
];
const cardById = (id) => baseCards.find((c) => c.id === Number(id));
const COPIES_PER_CARD = 3;
function buildDeck() {
  const deck = [];
  for (const c of baseCards) {
    for (let i = 0; i < COPIES_PER_CARD; i++) {
      deck.push({ ...c, copies: COPIES_PER_CARD, uid: `${c.id}-${randomId()}` });
    }
  }
  return shuffle(deck);
}

class Room {
  constructor(hostName) {
    this.code = roomCode();
    this.hostId = randomId();
    this.players = [{
      id: this.hostId,
      token: randomId(),
      name: sanitizeName(hostName),
      connected: true,
      points: 0,
      hand: [],
      alive: true,
      away: false,
      untargetable: false,
      playedThisTurn: 0,
    }];
    this.status = 'lobby';
    this.streams = new Map();
    this.prompts = new Map();
    this.busy = false;
    this.game = null;
    this.createdAt = Date.now();
  }
}

function sanitizeName(name) {
  return String(name || 'プレイヤー').trim().slice(0, 16) || 'プレイヤー';
}
function playerOf(room, playerId) { return room.players.find((p) => p.id === playerId); }
function validateAuth(room, playerId, token) {
  const p = playerOf(room, playerId);
  return !!p && p.token === token;
}
function gamePlayer(room, playerId) {
  return room.game?.players.find((p) => p.id === playerId) || null;
}
function currentPlayer(room) { return room.game?.players[room.game.current] || null; }
function alivePlayers(room) { return room.game.players.filter((p) => p.alive); }
function targetablePlayers(room) { return room.game.players.filter((p) => p.alive && !p.away); }
function playerHasCard(player, id) { return !!player?.hand?.some((c) => c.id === id); }
function takeCardById(room, player, id) {
  const idx = player.hand.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const [card] = player.hand.splice(idx, 1);
  room.game.discard.push(card);
  return card;
}
function log(room, msg, type = 'normal') {
  room.game.logs.unshift({ time: nowLabel(), msg, type });
  room.game.logs = room.game.logs.slice(0, 100);
}
function trackTrap(room, name, description) {
  room.game.activeTrap = { name, description, time: nowLabel() };
  room.game.trapHistory.unshift({ name, description, time: nowLabel() });
  room.game.trapHistory = room.game.trapHistory.slice(0, 8);
}
function getPlayerStatusText(room, p) {
  const s = [];
  if (p.away) s.push('🚻 ゲーム外');
  if (p.untargetable) s.push('空気');
  const links = room.game.soulLinks.filter((l) => l.includes(p.id));
  if (links.length) s.push(`運命共同体×${links.length}`);
  return s.length ? s.join(' / ') : '通常進行';
}
function stateRules(room) {
  const g = room.game;
  const labels = [];
  if (g.direction === -1) labels.push('🔄 ターン逆回り');
  if (g.handLimit != null) labels.push(`✋ 手札上限 ${g.handLimit}枚`);
  g.rules.forEach((r) => labels.push(r.label));
  g.soulLinks.forEach((link) => {
    const a = g.players.find((p) => p.id === link[0]);
    const b = g.players.find((p) => p.id === link[1]);
    if (a && b) labels.push(`🤝 運命共同体：${a.name} ⇄ ${b.name}`);
  });
  g.bannedNames.forEach((n) => labels.push(`🚫 使用禁止：${n}`));
  return labels;
}

function publicState(room, viewerId) {
  if (room.status === 'lobby') {
    return {
      status: 'lobby',
      roomCode: room.code,
      hostId: room.hostId,
      me: viewerId,
      players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      canStart: viewerId === room.hostId && room.players.length >= 3,
      canTestStart: viewerId === room.hostId && room.players.length === 2,
    };
  }
  const g = room.game;
  const me = g.players.find((p) => p.id === viewerId);
  const cur = currentPlayer(room);
  return {
    status: 'playing',
    roomCode: room.code,
    hostId: room.hostId,
    me: viewerId,
    round: g.round,
    gameOver: g.gameOver,
    roundLocked: g.roundLocked,
    direction: g.direction,
    handLimit: g.handLimit,
    deckCount: g.deck.length,
    discardCount: g.discard.length,
    currentPlayerId: cur?.id || null,
    currentPlayerName: cur?.name || '',
    drawnThisTurn: g.drawnThisTurn,
    busy: room.busy,
    rules: stateRules(room),
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      points: p.points,
      alive: p.alive,
      away: p.away,
      connected: p.connected,
      handCount: p.hand.length,
      playedThisTurn: p.playedThisTurn,
      statusText: getPlayerStatusText(room, p),
    })),
    myHand: me ? me.hand.map((c) => ({ uid: c.uid, id: c.id, name: c.name, type: c.type, text: c.text, attack: !!c.attack })) : [],
    logs: g.logs,
    activeTrap: g.activeTrap,
    trapHistory: g.trapHistory,
    lastPlayed: g.lastPlayed,
    canDraw: !!me && me.alive && !me.away && cur?.id === me.id && !g.drawnThisTurn && !g.roundLocked,
    canEndTurn: !!me && me.alive && cur?.id === me.id && !g.roundLocked,
    canPlayTurnCard: !!me && me.alive && !me.away && cur?.id === me.id && me.playedThisTurn < 1 && !g.roundLocked,
  };
}

function sseSend(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
function pushState(room) {
  for (const [pid, res] of room.streams.entries()) {
    if (!res.writableEnded) sseSend(res, 'state', publicState(room, pid));
  }
}
function pushNotice(room, playerId, payload) {
  const res = room.streams.get(playerId);
  if (res && !res.writableEnded) sseSend(res, 'notice', payload);
}
function pushFx(room, payload) {
  for (const res of room.streams.values()) if (!res.writableEnded) sseSend(res, 'fx', payload);
}
function pushPrompt(room, playerId, prompt) {
  const res = room.streams.get(playerId);
  if (res && !res.writableEnded) sseSend(res, 'prompt', prompt);
}

async function askPlayer(room, playerId, { title, message = '', options = [], skin = 'normal', kind = 'choice', timeoutMs = 45000, defaultValue = null }) {
  const player = gamePlayer(room, playerId);
  if (!player || !room.streams.has(playerId)) return defaultValue;
  const requestId = randomId();
  const payload = { requestId, title, message, options, skin, kind, timeoutMs };
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      room.prompts.delete(requestId);
      resolve(defaultValue);
      pushNotice(room, playerId, { text: '選択時間切れ。既定の処理で進行したわ。' });
    }, timeoutMs);
    room.prompts.set(requestId, { playerId, resolve, timer, payload });
    pushPrompt(room, playerId, payload);
  });
}

async function askUseInterrupt(room, player, cardIds, title, message) {
  if (!player || !player.alive || player.away) return null;
  const available = cardIds.filter((id) => playerHasCard(player, id));
  if (!available.length) return null;
  const options = available.map((id) => ({ label: `《${cardById(id).name}》を使う`, value: String(id), primary: id === 19 || id === 8 }));
  options.push({ label: '使わない', value: '' });
  const picked = await askPlayer(room, player.id, { title: `${player.name}：${title}`, message: `${message}\n\n※割込カードは1ターン1枚制に数えない。`, options, defaultValue: '' });
  if (!picked) return null;
  const card = takeCardById(room, player, Number(picked));
  if (card) log(room, `${player.name}が割込《${card.name}》を使用。`, 'rule');
  pushState(room);
  return card;
}
async function askFirstInterruptHolder(room, cardId, title, message, { excludeIds = [] } = {}) {
  for (const p of room.game.players) {
    if (!p.alive || p.away || excludeIds.includes(p.id) || !playerHasCard(p, cardId)) continue;
    const used = await askUseInterrupt(room, p, [cardId], title, message);
    if (used) return { player: p, card: used };
  }
  return null;
}
function interruptFx(room, entries, playerId = null) {
  pushFx(room, { type: 'interrupt', entries, playerId });
}
function eliminationFx(room, player, reason) {
  pushFx(room, { type: 'elimination', playerId: player.id, name: player.name, reason });
}

function startGame(room, testMode = false) {
  room.status = 'playing';
  room.testMode = !!testMode;
  room.players = room.players.map((p) => ({
    ...p,
    points: p.points || 0,
    hand: [], alive: true, away: false, untargetable: false, playedThisTurn: 0,
  }));
  room.game = {
    players: room.players,
    deck: [], discard: [], current: 0, round: 1, direction: 1, handLimit: null,
    drawnThisTurn: false, rules: [], gameOver: false, roundLocked: false,
    logs: [], activeTrap: null, trapHistory: [], lastPlayed: null, lastResolvedCard: null,
    soulLinks: [], bannedNames: [],
  };
  startRound(room);
}
function startRound(room) {
  const g = room.game;
  g.deck = buildDeck();
  g.discard = [];
  g.current = 0;
  g.direction = 1;
  g.handLimit = null;
  g.drawnThisTurn = false;
  g.rules = [];
  g.roundLocked = false;
  g.activeTrap = null;
  g.trapHistory = [];
  g.lastPlayed = null;
  g.lastResolvedCard = null;
  g.soulLinks = [];
  g.bannedNames = [];
  g.logs = [];
  g.players.forEach((p) => {
    p.hand = [];
    p.alive = true;
    p.away = false;
    p.untargetable = false;
    p.playedThisTurn = 0;
  });
  for (let n = 0; n < 5; n++) g.players.forEach((p) => { if (g.deck.length) p.hand.push(g.deck.pop()); });
  log(room, `ラウンド${g.round}開始。全員5枚。通常・継続・特殊・TRAPは自分のターンに1枚、割込は条件成立時に別枠。${room.testMode ? '【2人テストモード】' : ''}`, 'win');
  pushState(room);
}
async function ensureDeck(room) {
  const g = room.game;
  if (g.deck.length) return true;
  g.deck = shuffle(g.discard);
  g.discard = [];
  if (!g.deck.length) return false;
  log(room, '捨て札を山札に戻してシャッフルした。', 'rule');
  return true;
}
function enforceHandLimit(room, player) {
  const g = room.game;
  if (g.handLimit == null) return;
  while (player.hand.length > g.handLimit) {
    const idx = Math.floor(Math.random() * player.hand.length);
    const [c] = player.hand.splice(idx, 1);
    g.discard.push(c);
    log(room, `${player.name}は手札上限により《${c.name}》を捨てた。`, 'rule');
  }
}
async function drawCard(room, player, announce = true) {
  if (!player?.alive) return null;
  const g = room.game;
  if (g.rules.some((r) => r.kind === 'noDraw')) {
    const breaker = await askFirstInterruptHolder(room, 74, 'いや引けよ', `${player.name}のドローが禁止されている。解除して全員1枚引く？`);
    if (!breaker) {
      if (announce) log(room, `${player.name}はドロー禁止中。`, 'rule');
      return null;
    }
    interruptFx(room, [{ name: 'カード引くの禁止！', owner: '場のルール' }, { name: 'いや引けよ', owner: breaker.player.name }], breaker.player.id);
    g.rules = g.rules.filter((r) => r.kind !== 'noDraw');
    log(room, '《いや引けよ》によりドロー禁止が解除。ゲーム内の生存者全員が1枚引く。', 'rule');
    for (const pl of [...targetablePlayers(room)]) if (pl.alive) await drawCard(room, pl, false);
    return null;
  }
  if (!(await ensureDeck(room))) return null;
  const card = g.deck.pop();
  if (announce) log(room, `${player.name}が1枚引いた。`, 'normal');
  if (card.auto && card.effect === 'drawDeath') {
    g.discard.push(card);
    g.lastPlayed = { by: '山札', name: card.name, type: card.type, text: card.text, target: player.name };
    log(room, `💥 ${player.name}が《引いたね？》を引いた！`, 'danger');
    const safe = await askUseInterrupt(room, player, [22], '引いたね？', '《セーフ！》でこの事故を無効にする？');
    if (safe) {
      interruptFx(room, [{ name: '引いたね？', owner: '山札' }, { name: 'セーフ！', owner: player.name }], player.id);
      const nope = await askFirstInterruptHolder(room, 23, 'さらに割り込み！', `${player.name}の《セーフ！》を無効にする？`, { excludeIds: [player.id] });
      if (!nope) {
        log(room, `${player.name}は《セーフ！》で生き残った。`, 'rule');
        pushState(room);
        return card;
      }
      interruptFx(room, [{ name: '引いたね？', owner: '山札' }, { name: 'セーフ！', owner: player.name }, { name: 'セーフじゃないよ', owner: nope.player.name }], nope.player.id);
      log(room, `《セーフじゃないよ》により${player.name}のセーフは取り消された。`, 'danger');
    }
    await attemptEliminate(room, player, '《引いたね？》', null, { allowReflect: false, allowPrevent: true });
    pushState(room);
    return card;
  }
  player.hand.push(card);
  await offerDrawSteal(room, player, card);
  if (player.hand.some((c) => c.uid === card.uid)) enforceHandLimit(room, player);
  pushState(room);
  return card;
}

async function askTarget(room, source, title, { includeSelf = false, candidates = null, includeAway = false, ignoreUntargetable = false, attackTargeting = false, ignoreMainCharacter = false } = {}) {
  let choices = (candidates || (includeAway ? alivePlayers(room) : targetablePlayers(room)))
    .filter((p) => p.alive && (includeAway || !p.away) && (ignoreUntargetable || !p.untargetable) && (includeSelf || p.id !== source?.id));
  if (attackTargeting && room.game.rules.some((r) => r.kind === 'focusLeader') && choices.length) {
    const max = Math.max(...choices.map((p) => p.points));
    choices = choices.filter((p) => p.points === max);
  }
  if (!ignoreMainCharacter) {
    const heroRule = room.game.rules.find((r) => r.kind === 'mainCharacter');
    const hero = heroRule ? room.game.players.find((p) => p.id === heroRule.owner) : null;
    if (hero?.alive && !hero.away && choices.some((p) => p.id === hero.id)) choices = [hero];
  }
  if (!choices.length) return null;
  const options = choices.map((p) => ({ label: p.name, value: p.id }));
  options.push({ label: 'やめる', value: '' });
  const selected = await askPlayer(room, source.id, { title, message: '対象を選んで。', options, defaultValue: '' });
  return selected ? room.game.players.find((p) => p.id === selected) || null : null;
}
async function askCardFromHand(room, player, title, { filter = null, allowCancel = false } = {}) {
  const cards = filter ? player.hand.filter(filter) : [...player.hand];
  if (!cards.length) return null;
  const options = cards.map((c) => ({ label: `${c.name}［${c.type}］`, value: c.uid }));
  if (allowCancel) options.push({ label: 'やめる', value: '' });
  const uid = await askPlayer(room, player.id, { title, message: 'カードを選んで。', options, defaultValue: allowCancel ? '' : cards[0].uid });
  return uid ? player.hand.find((c) => c.uid === uid) || null : null;
}

async function resolveCancelWindow(room, card, source) {
  if (card.type === '割込' || card.type === '強制') return false;
  if (card.id === 36) {
    const breaker = await askFirstInterruptHolder(room, 37, '静粛に異議あり', '《静粛に！》を今すぐ解除する？', { excludeIds: [source.id] });
    if (breaker) {
      interruptFx(room, [{ name: card.name, owner: source.name }, { name: 'いやゲームできないだろ', owner: breaker.player.name }], breaker.player.id);
      log(room, '《いやゲームできないだろ》により《静粛に！》は無効になった。', 'rule');
      return true;
    }
  }
  const banCancel = await askFirstInterruptHolder(room, 30, 'そんなルールあった？', `${source.name}が《${card.name}》を使った。同名ごと封印する？`, { excludeIds: [source.id] });
  if (banCancel) {
    interruptFx(room, [{ name: card.name, owner: source.name }, { name: 'そんなルールあった？', owner: banCancel.player.name }], banCancel.player.id);
    const madeNow = await askFirstInterruptHolder(room, 31, '今作った！', '《そんなルールあった？》を無効にして元のカードを通す？', { excludeIds: [banCancel.player.id] });
    if (madeNow) {
      interruptFx(room, [{ name: card.name, owner: source.name }, { name: 'そんなルールあった？', owner: banCancel.player.name }, { name: '今作った', owner: madeNow.player.name }], madeNow.player.id);
      log(room, `《今作った》により《${card.name}》は予定通り発動する。`, 'rule');
      return false;
    }
    if (!room.game.bannedNames.includes(card.name)) room.game.bannedNames.push(card.name);
    log(room, `《そんなルールあった？》により《${card.name}》は無効。このラウンド中、同名カードは使用禁止。`, 'rule');
    return true;
  }
  if (card.type === 'TRAP') return false;
  const cancel = await askFirstInterruptHolder(room, 7, '割り込みチャンス', `${source.name}が《${card.name}》を使った。無効にする？`, { excludeIds: [source.id] });
  if (!cancel) return false;
  interruptFx(room, [{ name: card.name, owner: source.name }, { name: 'ちょっと待った！', owner: cancel.player.name }], cancel.player.id);
  const uncancel = await askFirstInterruptHolder(room, 8, 'さらに割り込み！', '《ちょっと待った！》を無効にして元のカードを通す？', { excludeIds: [cancel.player.id] });
  if (uncancel) {
    interruptFx(room, [{ name: card.name, owner: source.name }, { name: 'ちょっと待った！', owner: cancel.player.name }, { name: 'ちょっと待たない！', owner: uncancel.player.name }], uncancel.player.id);
    log(room, `《ちょっと待たない！》により《${card.name}》は予定通り発動する。`, 'rule');
    return false;
  }
  log(room, `《ちょっと待った！》により《${card.name}》は無効になった。`, 'rule');
  return true;
}

async function attemptEliminate(room, target, reason, source = null, { allowReflect = true, allowPrevent = true, allowRevenge = true, ignoreUntargetable = false, ignoreAway = false, ignoreProtectLast = false } = {}) {
  if (!target?.alive) return false;
  const g = room.game;
  if (target.away && !ignoreAway) { log(room, `${target.name}はゲーム外に退避中なので効果を受けない。`, 'rule'); return false; }
  if (target.untargetable && source && !ignoreUntargetable) { log(room, `${target.name}は空気なので対象にできない。`, 'rule'); return false; }
  if (!ignoreProtectLast && source && g.rules.some((r) => r.kind === 'protectLast')) {
    const living = alivePlayers(room);
    const min = living.length ? Math.min(...living.map((p) => p.points)) : target.points;
    if (target.points === min) { log(room, `🛡 ${target.name}は《弱い者いじめ禁止》に守られた。`, 'rule'); return false; }
  }
  const defensive = [];
  if (allowReflect && source && source.id !== target.id && playerHasCard(target, 2)) defensive.push(2);
  if (allowPrevent && playerHasCard(target, 18)) defensive.push(18);
  if (defensive.length) {
    const used = await askUseInterrupt(room, target, defensive, '脱落直前！', `${target.name}が「${reason}」で脱落しそう。`);
    if (used?.id === 2) {
      interruptFx(room, [{ name: reason, owner: source?.name || 'SYSTEM' }, { name: used.name, owner: target.name }], target.id);
      log(room, `${target.name}が脱落を${source.name}へ返した！`, 'danger');
      await attemptEliminate(room, source, '《いや、お前が負けろよ》による反射', target);
      return false;
    }
    if (used?.id === 18) {
      interruptFx(room, [{ name: reason, owner: source?.name || 'SYSTEM' }, { name: used.name, owner: target.name }], target.id);
      const cancel = await askFirstInterruptHolder(room, 19, '神への異議申し立て', `${target.name}の脱落無効化を無効にする？`, { excludeIds: [target.id] });
      if (!cancel) { log(room, `${target.name}は神に救われた。`, 'rule'); return false; }
      interruptFx(room, [{ name: reason, owner: source?.name || 'SYSTEM' }, { name: used.name, owner: target.name }, { name: '神「やっぱ死んで」', owner: cancel.player.name }], cancel.player.id);
      log(room, `神は考え直した。${target.name}の脱落は続行。`, 'danger');
    }
  }
  target.alive = false;
  target.away = false;
  target.untargetable = false;
  g.rules = g.rules.filter((r) => r.owner !== target.id);
  eliminationFx(room, target, reason);
  log(room, `☠ ${target.name} 脱落（${reason}）`, 'danger');
  pushState(room);

  if (allowRevenge && playerHasCard(target, 13)) {
    const revenge = await askUseInterrupt(room, target, [13], '脱落後の最後っ屁', '《巻き添え》で誰かを道連れにする？');
    if (revenge) {
      const t = await askTarget(room, target, '巻き添えにする相手を選択', { candidates: alivePlayers(room), ignoreMainCharacter: true });
      if (t) await attemptEliminate(room, t, '《巻き添え》', target);
    }
  }
  if (playerHasCard(target, 52)) {
    const will = await askUseInterrupt(room, target, [52], '遺言', '残った手札を誰か1人へ全部託す？');
    if (will && target.hand.length) {
      const heir = await askTarget(room, target, '遺産を受け取るプレイヤーを選択', { candidates: targetablePlayers(room), ignoreMainCharacter: true });
      if (heir) await transferBatch(room, target, heir, [...target.hand], { reason: '《遺言》' });
    }
  }
  const linked = g.soulLinks.filter((l) => l.includes(target.id));
  for (const link of linked) {
    const otherId = link[0] === target.id ? link[1] : link[0];
    const other = g.players.find((p) => p.id === otherId);
    if (other?.alive) {
      log(room, `🤝 ${target.name}の脱落により、運命共同体の${other.name}も脱落対象。`, 'danger');
      await attemptEliminate(room, other, '運命共同体', target, { allowReflect: false, allowPrevent: true, allowRevenge: true });
    }
  }
  return true;
}

async function transferSingleCard(room, source, target, card, { reason = 'カード移動', allowReject = false, steal = false, suppressPunish = false } = {}) {
  if (!source || !target || !card) return false;
  const idx = source.hand.findIndex((c) => c.uid === card.uid);
  if (idx < 0) return false;
  if (allowReject && playerHasCard(target, 55)) {
    const reject = await askUseInterrupt(room, target, [55], '受取拒否', `${source.name}から《${card.name}》を渡されそう。送り返す？`);
    if (reject) {
      const noReturns = await askUseInterrupt(room, source, [56], '返品不可です', `${target.name}の受取拒否を無効にする？`);
      if (!noReturns) {
        log(room, `${target.name}は《${card.name}》を受取拒否した。`, 'rule');
        return false;
      }
      interruptFx(room, [{ name: '受取拒否', owner: target.name }, { name: '返品不可です', owner: source.name }], source.id);
      log(room, `《返品不可です》により${target.name}は受け取るしかない。`, 'rule');
    }
  }
  source.hand.splice(idx, 1);
  target.hand.push(card);
  log(room, `${reason}：${source.name} → ${target.name}《${card.name}》`, steal ? 'danger' : 'normal');
  await checkCurseReceived(room, target, [card], reason);
  enforceHandLimit(room, target);
  if (steal && !suppressPunish) await triggerPunishSteal(room, target, source);
  return true;
}

async function transferBatch(room, source, target, cards, { reason = 'まとめてカード移動' } = {}) {
  const moved = [];
  for (const card of [...cards]) {
    const idx = source.hand.findIndex((c) => c.uid === card.uid);
    if (idx >= 0) {
      const [c] = source.hand.splice(idx, 1);
      target.hand.push(c);
      moved.push(c);
    }
  }
  if (moved.length) {
    log(room, `${reason}：${source.name}から${target.name}へ${moved.length}枚渡った。`, 'normal');
    await checkCurseReceived(room, target, moved, reason);
    enforceHandLimit(room, target);
  }
  return moved;
}

async function triggerPunishSteal(room, thief, victim) {
  if (!thief?.alive || !victim?.alive) return;
  const punish = await askFirstInterruptHolder(room, 42, '欲張りさんね', `${thief.name}がカードを奪った。さらにその人から最大2枚奪う？`, { excludeIds: [thief.id] });
  if (!punish) return;
  interruptFx(room, [{ name: 'カード強奪', owner: thief.name }, { name: '欲張りさんね', owner: punish.player.name }], punish.player.id);
  for (let i = 0; i < 2 && thief.hand.length; i++) {
    const chosen = await askCardFromHand(room, thief, `${punish.player.name}：《欲張りさんね》`, { allowCancel: i > 0 });
    if (!chosen) break;
    await transferSingleCard(room, thief, punish.player, chosen, { reason: '《欲張りさんね》', steal: true, suppressPunish: true });
  }
}

async function offerDrawSteal(room, drawer, card) {
  if (!drawer?.alive || drawer.away || !card || !drawer.hand.some((c) => c.uid === card.uid)) return;
  const stealer = await askFirstInterruptHolder(room, 41, 'それ俺の', `${drawer.name}が《${card.name}》を引いた。横取りする？`, { excludeIds: [drawer.id] });
  if (!stealer) return;
  interruptFx(room, [{ name: `ドロー：${card.name}`, owner: drawer.name }, { name: 'それ俺の', owner: stealer.player.name }], stealer.player.id);
  await transferSingleCard(room, drawer, stealer.player, card, { reason: '《それ俺の》', steal: true });
}

async function checkCurseReceived(room, target, cards, reason = 'カード移動') {
  if (target?.alive && !target.away && cards?.some((c) => c.id === 53)) {
    log(room, `☠ ${target.name}が${reason}で《呪いの遺産》を受け取った。`, 'danger');
    await attemptEliminate(room, target, '《呪いの遺産》を受け取った', null, { allowReflect: false, allowPrevent: true, allowRevenge: true });
  }
}

async function postResolveInterrupts(room, card, source) {
  if (room.game.roundLocked || !source?.alive || source.away || card.type === '割込' || card.type === '強制') return;
  const caller = await askFirstInterruptHolder(room, 28, '責任者を呼べ！', `${source.name}が《${card.name}》を解決した。責任を取らせる？`, { excludeIds: [source.id] });
  if (!caller) return;
  interruptFx(room, [{ name: card.name, owner: source.name }, { name: '責任者を呼べ！', owner: caller.player.name }], caller.player.id);
  const reverse = await askUseInterrupt(room, source, [29], '責任者です', '《私が責任者です》で責任を押し返す？');
  if (reverse) {
    interruptFx(room, [{ name: card.name, owner: source.name }, { name: '責任者を呼べ！', owner: caller.player.name }, { name: '私が責任者です', owner: source.name }], source.id);
    await attemptEliminate(room, caller.player, '《私が責任者です》', source);
    return;
  }
  await attemptEliminate(room, source, '《責任者を呼べ！》', caller.player);
}

async function playCard(room, playerId, uid) {
  const g = room.game;
  const p = gamePlayer(room, playerId);
  const cur = currentPlayer(room);
  if (!p || cur?.id !== p.id || !p.alive || p.away || g.roundLocked) throw new Error('今はあなたのカード使用タイミングじゃないわ。');
  const index = p.hand.findIndex((c) => c.uid === uid);
  const card = p.hand[index];
  if (!card) throw new Error('そのカードは手札にないわ。');
  if (card.type === '割込') throw new Error('割込カードは条件成立時に使うカードよ。');
  if (card.type === '強制') throw new Error('強制カードは自分から使えないわ。');
  if (p.playedThisTurn >= 1) throw new Error('このターンはもう1枚使ってるわ。');
  if (g.bannedNames.includes(card.name)) throw new Error('そのカード名はこのラウンド中使用禁止よ。');
  if (card.id === 20 && p.hand.length !== 1) throw new Error('《THE クールソウル》は最後の手札でないと使えないわ。');
  if (card.id === 59 && (alivePlayers(room).length !== 2 || alivePlayers(room).some((x) => x.away))) throw new Error('生存者がちょうど2人の時だけ使えるわ。');
  if (card.id === 78 && !g.rules.some((r) => r.kind === 'peace')) throw new Error('平和条約が出ていないわ。');
  const peaceBlocked = g.rules.some((r) => r.kind === 'peace') && ['eliminateTarget','mostHandOut','revealWinWordOut','vote','topPointOut','friendshipRandomOut','randomOut','doubleRandomOut','findInvisible','allOut','finalCoin'].includes(card.effect);
  if (peaceBlocked) throw new Error('平和条約中はその脱落カードを使えないわ。');

  p.hand.splice(index, 1);
  g.discard.push(card);
  p.playedThisTurn++;
  g.lastPlayed = { by: p.name, name: card.name, type: card.type, text: card.text, target: '' };
  log(room, `${p.name}が《${card.name}》を使用。`, card.type === 'TRAP' ? 'trap' : 'normal');
  pushState(room);

  const canceled = await resolveCancelWindow(room, card, p);
  if (!canceled && !g.roundLocked) {
    await resolveCardEffect(room, card, p);
    if (!g.roundLocked) {
      g.lastResolvedCard = { id: card.id, name: card.name, type: card.type, text: card.text, effect: card.effect, attack: card.attack };
      await postResolveInterrupts(room, card, p);
    }
  }
  checkRoundEnd(room);
  pushState(room);
}

async function resolveCardEffect(room, card, p, { copy = false, randomTarget = false } = {}) {
  const g = room.game;
  switch (card.effect) {
    case 'eliminateTarget': {
      const t = randomTarget ? shuffle(targetablePlayers(room).filter((x) => x.id !== p.id && !x.untargetable))[0] : await askTarget(room, p, '脱落させる相手を選択', { attackTargeting: true });
      if (t) { g.lastPlayed.target = t.name; await attemptEliminate(room, t, `《${card.name}》`, p); }
      break;
    }
    case 'mostHandOut': {
      const alive = targetablePlayers(room); if (!alive.length) break;
      const max = Math.max(...alive.map((x) => x.hand.length));
      for (const t of alive.filter((x) => x.hand.length === max)) await attemptEliminate(room, t, `《${card.name}》`, p);
      break;
    }
    case 'revealWinWordOut': {
      const hits = targetablePlayers(room).filter((x) => x.hand.some((c) => c.name.includes('勝')));
      log(room, `手札公開判定：「勝」を持つのは ${hits.map((x) => x.name).join('、') || 'なし'}。`, 'normal');
      for (const t of hits) await attemptEliminate(room, t, `《${card.name}》`, p);
      break;
    }
    case 'vote': await runVote(room, p); break;
    case 'topPointOut': {
      const alive = targetablePlayers(room); if (!alive.length) break;
      const max = Math.max(...alive.map((x) => x.points));
      for (const t of alive.filter((x) => x.points === max)) await attemptEliminate(room, t, `《${card.name}》`, p);
      break;
    }
    case 'bottomDraw': await bottomRescue(room, p); break;
    case 'allDiscardDraw3ExclaimWin': await seriousMode(room, p); break;
    case 'repeatLastRandom': await repeatLastCardRandom(room, p); break;
    case 'soulLink': {
      const t = await askTarget(room, p, '運命共同体にする相手を選択');
      if (t) { g.soulLinks.push([p.id, t.id]); log(room, `🤝 ${p.name}と${t.name}が運命共同体になった。`, 'rule'); }
      break;
    }
    case 'friendshipRandomOut': await friendshipOut(room, p); break;
    case 'coolSoulWin': await specialRoundWin(room, p, '《THE クールソウル》'); break;
    case 'nothing': await nothingHappened(room, p); break;
    case 'randomOut': {
      const a = targetablePlayers(room).filter((x) => !x.untargetable);
      if (a.length) await attemptEliminate(room, a[Math.floor(Math.random() * a.length)], `《${card.name}》`, p);
      break;
    }
    case 'doubleRandomOut': {
      for (const t of shuffle(targetablePlayers(room).filter((x) => !x.untargetable)).slice(0, 2)) await attemptEliminate(room, t, `《${card.name}》`, p);
      break;
    }
    case 'rotateHands': await rotateHandsChaos(room, p); break;
    case 'peekAndSteal': await peekAndSteal(room, p, randomTarget); break;
    case 'trapEye': await trapEye(room, p, randomTarget); break;
    case 'silence': g.rules.push({ kind: 'silence', owner: p.id, label: `🤫 静粛に！（${p.name}の次ターン開始まで）` }); log(room, '《静粛に！》が有効。チャットで発言すると脱落する。', 'rule'); break;
    case 'reorderTop3': await reorderTop3(room, p); break;
    case 'discardTop': await discardTop(room, p); break;
    case 'mainCharacter': p.untargetable = false; g.rules = g.rules.filter((r) => !(r.kind === 'mainCharacter' && r.owner === p.id)); g.rules.push({ kind: 'mainCharacter', owner: p.id, label: `🌟 今日の主役：${p.name}` }); log(room, `${p.name}が今日の主役になった。単体対象は可能なら${p.name}へ。`, 'rule'); break;
    case 'untargetable': p.untargetable = true; g.rules.push({ kind: 'untargetable', owner: p.id, label: `☁ ${p.name}: 空気状態` }); log(room, `${p.name}は空気になった。`, 'rule'); break;
    case 'findInvisible': {
      const cands = targetablePlayers(room).filter((x) => x.untargetable && x.id !== p.id);
      const t = randomTarget ? shuffle(cands)[0] : await askTarget(room, p, '空気になっている相手を選択', { candidates: cands, ignoreUntargetable: true, ignoreMainCharacter: true });
      if (t) await attemptEliminate(room, t, '《お前いたの？》', p, { ignoreUntargetable: true });
      break;
    }
    case 'toilet': p.away = true; log(room, `🚻 ${p.name}はゲーム外へ退避した。次の自分のターン開始時に戻る。`, 'rule'); break;
    case 'gift': await giftCard(room, p); break;
    case 'allOut': await allOut(room, p); break;
    case 'finalCoin': await finalCoinToss(room, p); break;
    case 'reverse': g.direction *= -1; log(room, `ターン方向が${g.direction === -1 ? '逆回り' : '通常方向'}になった。`, 'rule'); break;
    case 'limit2': g.handLimit = 2; targetablePlayers(room).forEach((x) => enforceHandLimit(room, x)); log(room, '手札上限が2枚になった。', 'rule'); break;
    case 'noLimit': g.handLimit = null; log(room, '手札上限が撤廃された。', 'rule'); break;
    case 'noDraw': g.rules.push({ kind: 'noDraw', owner: p.id, label: `🚫 ドロー禁止（${p.name}の次ターン開始まで）` }); log(room, 'ドロー禁止ルールが追加された。', 'rule'); break;
    case 'cheatDraw': await cheatDraw(room, p); break;
    case 'peace': g.rules.push({ kind: 'peace', owner: p.id, label: `🕊 平和条約（${p.name}の次ターン開始まで）` }); log(room, '平和条約が結ばれた。', 'rule'); break;
    case 'breakPeace': await breakPeace(room, p); break;
    case 'revolution': await revolution(room, p); break;
    case 'banNumbers': g.rules.push({ kind: 'banNumbers', owner: p.id, label: `🔢 数字は禁止（${p.name}の次ターン開始まで）` }); break;
    case 'banKatakana': g.rules.push({ kind: 'banKatakana', owner: p.id, label: `🈲 カタカナ禁止（${p.name}の次ターン開始まで）` }); break;
    case 'nameCalling': g.rules.push({ kind: 'nameCalling', owner: p.id, label: `📛 名前で呼んで（${p.name}の次ターン開始まで）` }); break;
    case 'politeSpeech': g.rules.push({ kind: 'politeSpeech', owner: p.id, label: `🎩 敬語でお願いします（${p.name}の次ターン開始まで）` }); break;
    case 'chatDraw': {
      const breaker = await askFirstInterruptHolder(room, 86, '喋らないとゲームできないだろ！', '《黙ってゲームしろ》を即解除する？', { excludeIds: [p.id] });
      if (breaker) log(room, '《黙ってゲームしろ》は即座に解除された。', 'rule');
      else g.rules.push({ kind: 'chatDraw', owner: null, label: '💬 黙ってゲームしろ：発言するたび1枚引く' });
      break;
    }
    case 'leftRightVote': await runLeftRightVote(room); break;
    case 'redistribute': await redistribute(room); break;
    case 'recycleAllDiscard': await recycleDiscardIntoDeck(room, '《もう誰のカードかわかんねぇよ》'); break;
    case 'recycleChoice': await recycleChoiceFromDiscard(room, p, card); break;
    case 'deckToTen': while (g.deck.length > 10) g.discard.push(g.deck.pop()); log(room, `山札を${g.deck.length}枚まで削った。`, 'rule'); break;
    case 'extendGame': await recycleDiscardIntoDeck(room, '《延長戦入りまーす》'); break;
    case 'resetHands': {
      for (const x of g.players.filter((x) => x.alive && !x.away)) {
        g.discard.push(...x.hand); x.hand = [];
        for (let i = 0; i < 5 && x.alive; i++) await drawCard(room, x, false);
      }
      log(room, '全員の手札を5枚に引き直した。', 'rule');
      break;
    }
    case 'drawByPoints': for (let i = 0; i < p.points && p.alive; i++) await drawCard(room, p, false); break;
    case 'focusLeader': g.rules.push({ kind: 'focusLeader', owner: null, label: '🎯 強い奴を殴れ：単体脱落はポイント最多を優先' }); break;
    case 'protectLast': g.rules.push({ kind: 'protectLast', owner: null, label: '🛡 弱い者いじめ禁止：ポイント最少はカード脱落から保護' }); break;
    case 'removeProtectLast': g.rules = g.rules.filter((r) => r.kind !== 'protectLast'); log(room, '《弱い者いじめ禁止》を解除した。', 'rule'); break;
    case 'trapSafe': await trapSafe(room, p); break;
    case 'trapRight': await trapRight(room, p); break;
    default: log(room, `《${card.name}》のオンライン効果が見つからない。`, 'danger');
  }
}

async function runVote(room, source) {
  const voters = [...targetablePlayers(room)];
  if (voters.length < 2) return;
  const votes = new Map(voters.map((p) => [p.id, 0]));
  for (const voter of voters) {
    const cands = voters.filter((x) => x.id !== voter.id);
    const choice = await askPlayer(room, voter.id, {
      title: `${voter.name}：多数決`,
      message: '脱落させたい相手に投票して。',
      options: cands.map((x) => ({ label: x.name, value: x.id })),
      defaultValue: cands[0]?.id || '',
    });
    if (votes.has(choice)) votes.set(choice, votes.get(choice) + 1);
  }
  const max = Math.max(...votes.values());
  const min = Math.min(...votes.values());
  let losers = voters.filter((p) => votes.get(p.id) === max);
  const reverse = await askFirstInterruptHolder(room, 6, '民主主義って怖いね', `最多票は ${losers.map((x) => x.name).join('、')}。最少票の人を脱落対象に変える？`);
  if (reverse) {
    interruptFx(room, [{ name: '多数決を始めます', owner: source.name }, { name: '民主主義って怖いね', owner: reverse.player.name }], reverse.player.id);
    losers = voters.filter((p) => votes.get(p.id) === min);
  }
  log(room, `投票結果：${[...votes.entries()].map(([id, n]) => `${voters.find((p) => p.id === id)?.name}:${n}`).join(' / ')}`, 'normal');
  for (const loser of losers) await attemptEliminate(room, loser, '《多数決を始めます》', source);
}

async function bottomRescue(room, source) {
  const alive = targetablePlayers(room);
  if (!alive.length) return;
  const min = Math.min(...alive.map((x) => x.points));
  for (const t of alive.filter((x) => x.points === min)) {
    const drawn = [];
    while (t.alive && t.hand.length < 5) {
      const before = new Set(t.hand.map((c) => c.uid));
      await drawCard(room, t, false);
      const fresh = t.hand.find((c) => !before.has(c.uid));
      if (fresh) drawn.push(fresh);
    }
    if (drawn.length && drawn.every((c) => c.attack)) await attemptEliminate(room, t, '《最下位救済キャンペーン》で引いたカードが全部攻撃カード', source);
  }
}
async function seriousMode(room, p) {
  room.game.discard.push(...p.hand);
  p.hand = [];
  const drawn = [];
  for (let i = 0; i < 3 && p.alive; i++) {
    const before = new Set(p.hand.map((c) => c.uid));
    await drawCard(room, p, false);
    const fresh = p.hand.find((c) => !before.has(c.uid));
    if (fresh) drawn.push(fresh);
  }
  if (drawn.length === 3 && drawn.every((c) => c.name.includes('！'))) await specialRoundWin(room, p, '《今から本気出す》');
}
async function repeatLastCardRandom(room, p) {
  const last = room.game.lastResolvedCard;
  if (!last || !last.effect || ['repeatLastRandom','coolSoulWin'].includes(last.effect)) {
    log(room, '再発動できる直前カードがなかった。', 'rule');
    return;
  }
  log(room, `《知らんけど》が《${last.name}》をもう一度やる。`, 'rule');
  await resolveCardEffect(room, last, p, { copy: true, randomTarget: true });
}
async function friendshipOut(room, p) {
  const links = room.game.soulLinks.filter((l) => l.every((id) => room.game.players.find((x) => x.id === id)?.alive));
  if (!links.length) { log(room, '運命共同体がいないので何も起きなかった。', 'rule'); return; }
  const link = links[Math.floor(Math.random() * links.length)];
  const cands = targetablePlayers(room).filter((x) => !link.includes(x.id));
  if (!cands.length) { log(room, '運命共同体以外に誰もいない。', 'rule'); return; }
  await attemptEliminate(room, cands[Math.floor(Math.random() * cands.length)], '《友情って素晴らしい！》', p);
}

async function nothingHappened(room, source) {
  log(room, '……本当に何も起きなかった。', 'normal');
  const surprise = await askFirstInterruptHolder(room, 25, '何も起きないと思った？', 'ここで本当に終わると思った？');
  if (!surprise) return;
  interruptFx(room, [{ name: '何も起きません', owner: source.name }, { name: '何も起きないと思った？', owner: surprise.player.name }], surprise.player.id);
  for (const target of [...targetablePlayers(room)]) {
    if (target.id === surprise.player.id) continue;
    if (!target.hand.length) { await attemptEliminate(room, target, '捨てる手札がない', surprise.player); continue; }
    const chosen = await askCardFromHand(room, target, '捨てるカードを選択');
    if (chosen) {
      const idx = target.hand.findIndex((c) => c.uid === chosen.uid);
      if (idx >= 0) room.game.discard.push(target.hand.splice(idx, 1)[0]);
    }
  }
}

async function peekAndSteal(room, source, randomTarget = false) {
  const cands = targetablePlayers(room).filter((x) => x.id !== source.id && !x.untargetable);
  const target = randomTarget ? shuffle(cands)[0] : await askTarget(room, source, '手札を見る相手を選択');
  if (!target) return;
  room.game.lastPlayed.target = target.name;
  pushNotice(room, source.id, { text: `${target.name}の手札：${target.hand.map((c) => `《${c.name}》`).join(' / ') || '手札なし'}` });
  const attacks = target.hand.filter((c) => c.attack);
  if (attacks.length) {
    let stolen = attacks[0];
    if (!randomTarget && attacks.length > 1) {
      const uid = await askPlayer(room, source.id, { title: '奪う攻撃カード', message: `${target.name}から1枚奪える。`, options: attacks.map((c) => ({ label: c.name, value: c.uid })), defaultValue: attacks[0].uid });
      stolen = attacks.find((c) => c.uid === uid) || attacks[0];
    }
    await transferSingleCard(room, target, source, stolen, { reason: '《手札見せて♡》', steal: true });
  }
  const counter = await askUseInterrupt(room, target, [33], '見たな？', `${source.name}に手札を見られた。相手の手札を全員に晒す？`);
  if (counter) log(room, `📢 ${source.name}の手札が全公開：${source.hand.map((c) => `《${c.name}》`).join(' / ') || '手札なし'}`, 'danger');
}

async function trapEye(room, source, randomTarget = false) {
  const cands = targetablePlayers(room).filter((x) => x.id !== source.id && !x.untargetable);
  const target = randomTarget ? shuffle(cands)[0] : await askTarget(room, source, '目を合わせる相手を選択');
  if (!target) return;
  trackTrap(room, '目が合ったね', `${target.name}に視線確認UIを表示中。`);
  pushState(room);
  const choice = await askPlayer(room, target.id, {
    title: '視線トラッキング確認', skin: 'trap', kind: 'trap',
    message: '画面中央を見ていますか？\n同期精度向上のため視線状態を確認してください。\n※正直者ほど危険。',
    options: [{ label: '視線をそらす', value: 'safe' }, { label: 'はい、見ています', value: 'danger', primary: true }], defaultValue: 'safe'
  });
  room.game.activeTrap = null;
  if (choice === 'danger') await attemptEliminate(room, target, '《目が合ったね》', source);
}

async function reorderTop3(room, source) {
  if (!(await ensureDeck(room))) return;
  const count = Math.min(3, room.game.deck.length);
  const top = room.game.deck.slice(-count).reverse();
  const revealer = await askFirstInterruptHolder(room, 44, '見せろ', `${source.name}が山札上${count}枚を見ようとしている。全員に公開させる？`, { excludeIds: [source.id] });
  if (revealer) log(room, `《見せろ》：山札上を公開 → ${top.map((c) => c.name).join(' / ')}`, 'rule');
  if (top.length <= 1) return;
  const permutations = permute(top);
  const pick = await askPlayer(room, source.id, {
    title: '山札上3枚を並べ替える', message: '左から次に引かれる順。',
    options: permutations.map((arr, i) => ({ label: arr.map((c) => c.name).join(' → '), value: String(i) })), defaultValue: '0'
  });
  const chosen = permutations[Number(pick)] || top;
  room.game.deck.splice(room.game.deck.length - count, count);
  room.game.deck.push(...[...chosen].reverse());
}
function permute(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)]).forEach((rest) => out.push([x, ...rest])));
  return out;
}

async function discardTop(room, source) {
  if (!(await ensureDeck(room))) return;
  const blocker = await askFirstInterruptHolder(room, 46, '未来は変えられない', `${source.name}が山札トップを捨てようとしている。捨てずに使用者へ引かせる？`, { excludeIds: [source.id] });
  if (blocker) {
    interruptFx(room, [{ name: '未来は変えられる', owner: source.name }, { name: '未来は変えられない', owner: blocker.player.name }], blocker.player.id);
    await drawCard(room, source, false);
    return;
  }
  const c = room.game.deck.pop();
  room.game.discard.push(c);
  log(room, `山札トップ《${c.name}》を捨てた。`, 'rule');
}

async function rotateHandsChaos(room, source) {
  const alive = [...targetablePlayers(room)];
  if (alive.length < 2) return;
  let toRight = false;
  const reverse = await askFirstInterruptHolder(room, 39, '逆だったわ', '左じゃなくて右隣へ渡す？');
  if (reverse) toRight = true;
  const takeBack = [];
  for (const pl of alive) if (playerHasCard(pl, 40) && await askUseInterrupt(room, pl, [40], '返して', '手札移動後に1枚取り戻す？')) takeBack.push(pl.id);
  const snapshots = new Map(alive.map((pl) => [pl.id, pl.hand.map((c) => c.uid)]));
  const oldHands = alive.map((pl) => [...pl.hand]);
  alive.forEach((pl, i) => {
    const from = toRight ? (i - 1 + alive.length) % alive.length : (i + 1) % alive.length;
    pl.hand = oldHands[from];
  });
  log(room, `生存者の手札を${toRight ? '右' : '左'}隣へ渡した。`, 'rule');
  for (const ownerId of takeBack) {
    const ownerIndex = alive.findIndex((p) => p.id === ownerId);
    const receiverIndex = toRight ? (ownerIndex + 1) % alive.length : (ownerIndex - 1 + alive.length) % alive.length;
    const owner = alive[ownerIndex], receiver = alive[receiverIndex];
    const originalUids = new Set(snapshots.get(ownerId) || []);
    const recoverable = receiver.hand.filter((c) => originalUids.has(c.uid));
    if (!recoverable.length) continue;
    const uid = await askPlayer(room, owner.id, { title: '《返して》', message: '元の手札から1枚取り戻して。', options: recoverable.map((c) => ({ label: c.name, value: c.uid })), defaultValue: recoverable[0].uid });
    const idx = receiver.hand.findIndex((c) => c.uid === uid);
    if (idx < 0) continue;
    owner.hand.push(receiver.hand.splice(idx, 1)[0]);
    if (receiver.hand.length) owner.hand.push(receiver.hand.splice(Math.floor(Math.random() * receiver.hand.length), 1)[0]);
    enforceHandLimit(room, owner);
  }
  for (const pl of alive) {
    const own = new Set(snapshots.get(pl.id) || []);
    const curses = pl.hand.filter((c) => c.id === 53 && !own.has(c.uid));
    if (curses.length) await checkCurseReceived(room, pl, curses, '席替え');
  }
}

async function giftCard(room, p) {
  if (!p.hand.length) { log(room, '渡せる残り手札がなかった。', 'rule'); return; }
  const card = await askCardFromHand(room, p, 'プレゼントするカードを選択', { allowCancel: true });
  if (!card) return;
  const target = await askTarget(room, p, 'プレゼントする相手を選択');
  if (!target) return;
  await transferSingleCard(room, p, target, card, { reason: '《プレゼント！》', allowReject: true });
}

async function allOut(room, p) {
  const survivors = new Set();
  for (const x of targetablePlayers(room)) {
    if (playerHasCard(x, 58)) {
      const used = await askUseInterrupt(room, x, [58], 'それ勝者いなくない？', '全員脱落から自分だけ生き残る？');
      if (used) survivors.add(x.id);
    }
  }
  for (const x of [...targetablePlayers(room)]) if (!survivors.has(x.id)) await attemptEliminate(room, x, '《全員仲良く死のう？》', p, { allowReflect: false });
}

async function cheatDraw(room, p) {
  const blocker = await askFirstInterruptHolder(room, 76, '言ってるよ', `${p.name}の《1ターンに1枚とは言ってない》を止める？`, { excludeIds: [p.id] });
  if (blocker) {
    if (p.hand.length) {
      const c = await askCardFromHand(room, p, '《言ってるよ》：残り手札を1枚捨てる');
      if (c) room.game.discard.push(p.hand.splice(p.hand.findIndex((x) => x.uid === c.uid), 1)[0]);
    }
    return;
  }
  if (p.hand.length) {
    const c = await askCardFromHand(room, p, '捨てるカードを1枚選択');
    if (c) room.game.discard.push(p.hand.splice(p.hand.findIndex((x) => x.uid === c.uid), 1)[0]);
  }
  await drawCard(room, p, false); if (p.alive) await drawCard(room, p, false);
}
async function breakPeace(room, p) {
  room.game.rules = room.game.rules.filter((r) => r.kind !== 'peace');
  const t = await askTarget(room, p, '条約破棄後に脱落させる相手を選択', { attackTargeting: true });
  if (t) await attemptEliminate(room, t, '《条約破棄》', p);
}
async function revolution(room, p) {
  const blocker = await askFirstInterruptHolder(room, 80, '革命失敗', `${p.name}の革命を止める？`, { excludeIds: [p.id] });
  if (blocker) {
    room.game.discard.push(...p.hand); p.hand = [];
    log(room, `${p.name}の革命は失敗し、残り手札をすべて捨てた。`, 'danger');
    return;
  }
  const vals = room.game.players.map((x) => x.points);
  const min = Math.min(...vals), max = Math.max(...vals);
  room.game.players.forEach((x) => { x.points = max + min - x.points; });
  log(room, '革命成功。ポイント順位が反転した。', 'rule');
}

async function runLeftRightVote(room) {
  const voters = [...targetablePlayers(room)];
  if (!voters.length) return;
  const picks = new Map();
  for (const voter of voters) {
    const pick = await askPlayer(room, voter.id, {
      title: '時計回りってどっち？', skin: 'trap', kind: 'choice',
      message: 'どっちだと思う？',
      options: [{ label: '← 左', value: 'L' }, { label: '右 →', value: 'R', primary: true }],
      defaultValue: Math.random() < 0.5 ? 'L' : 'R'
    });
    picks.set(voter.id, pick);
  }
  const left = voters.filter((v) => picks.get(v.id) === 'L');
  const right = voters.filter((v) => picks.get(v.id) === 'R');
  log(room, `左右投票：← ${left.length}人 / → ${right.length}人。`, 'normal');
  if (left.length === right.length) {
    for (const v of voters) for (let i = 0; i < 2 && v.alive; i++) await drawCard(room, v, false);
    return;
  }
  if (left.length === 0 || right.length === 0) return;
  const minority = left.length < right.length ? left : right;
  for (const v of minority) if (v.alive) await drawCard(room, v, false);
}

async function recycleDiscardIntoDeck(room, reason) {
  if (!room.game.discard.length) { log(room, `${reason}：捨て札がない。`, 'rule'); return; }
  const count = room.game.discard.length;
  room.game.deck = shuffle([...room.game.deck, ...room.game.discard]);
  room.game.discard = [];
  log(room, `${reason}：捨て札${count}枚を山札へ戻してシャッフルした。`, 'rule');
}
async function recycleChoiceFromDiscard(room, player, currentCard) {
  const choices = room.game.discard.filter((c) => c.uid !== currentCard?.uid);
  if (!choices.length) { log(room, '回収できる捨て札がない。', 'rule'); return; }
  const uid = await askPlayer(room, player.id, {
    title: 'ゴミ箱漁り', message: '捨て札から好きな1枚を回収して。',
    options: choices.map((c) => ({ label: `${c.name}［${c.type}］`, value: c.uid })).concat([{ label: 'やめる', value: '' }]),
    defaultValue: ''
  });
  if (!uid) return;
  const idx = room.game.discard.findIndex((c) => c.uid === uid);
  if (idx < 0) return;
  const [recovered] = room.game.discard.splice(idx, 1);
  player.hand.push(recovered);
  log(room, `${player.name}が捨て札から《${recovered.name}》を回収した。`, 'normal');
  enforceHandLimit(room, player);
  if (!player.hand.some((c) => c.uid === recovered.uid)) return;
  const thief = await askFirstInterruptHolder(room, 91, 'それ捨てたやつだから', `${player.name}が《${recovered.name}》を回収した。そのカードを奪う？`, { excludeIds: [player.id] });
  if (thief) await transferSingleCard(room, player, thief.player, recovered, { reason: '《それ捨てたやつだから》', steal: true });
}

async function finalCoinToss(room, source) {
  const alive = alivePlayers(room);
  if (alive.length !== 2 || alive.some((x) => x.away)) return;
  const blocker = await askFirstInterruptHolder(room, 60, 'コインなんてねぇよ', `${source.name}がコイントスを始めようとしている。コインごと潰す？`, { excludeIds: [source.id] });
  if (blocker) {
    await attemptEliminate(room, source, '《コインなんてねぇよ》', blocker.player);
    return;
  }
  const opponent = alive.find((x) => x.id !== source.id);
  const sourceWins = Math.random() < 0.5;
  const loser = sourceWins ? opponent : source;
  log(room, `🪙 コイントス！ ${sourceWins ? source.name : opponent.name}の勝ち。`, 'normal');
  pushFx(room, { type: 'coin', winner: sourceWins ? source.name : opponent.name, loser: loser.name });
  await sleep(800);
  await attemptEliminate(room, loser, '《最後に笑うのは俺だ》', source);
}

async function specialRoundWin(room, winner, reason) {
  if (room.game.roundLocked || !winner.alive) return false;
  const stopper = await askFirstInterruptHolder(room, 16, '勝利への割り込み', `${winner.name}が${reason}でラウンド勝利しそう。止める？`, { excludeIds: [winner.id] });
  if (stopper) {
    const restore = await askUseInterrupt(room, winner, [17], '勝利を取り戻す？', '《いや勝ってるから》で《勝ったと思った？》を無効にする？');
    if (!restore) {
      room.game.discard.push(...winner.hand); winner.hand = [];
      log(room, `${winner.name}の特殊勝利は無効。手札も全部捨てた。`, 'danger');
      return false;
    }
  }
  await awardRoundWin(room, winner, reason);
  return true;
}
async function awardRoundWin(room, winner, reason) {
  const g = room.game;
  if (g.roundLocked) return;
  g.roundLocked = true;
  winner.points++;
  log(room, `🏆 ${winner.name} ラウンド勝利！ +1ポイント（${reason}）`, 'win');
  pushFx(room, { type: 'roundWin', name: winner.name, points: winner.points, reason });
  pushState(room);
  if (winner.points >= 3) {
    g.gameOver = true;
    pushFx(room, { type: 'gameWin', name: winner.name, points: winner.points });
    return;
  }
  setTimeout(() => {
    if (!rooms.has(room.code) || room.game.gameOver) return;
    room.game.round++;
    startRound(room);
  }, 3500);
}
function checkRoundEnd(room) {
  const g = room.game;
  if (g.gameOver || g.roundLocked) return true;
  const alive = alivePlayers(room);
  if (alive.length === 1) { awardRoundWin(room, alive[0], '最後の生存者'); return true; }
  if (alive.length === 0) {
    g.roundLocked = true;
    log(room, '全員脱落。勝者なし。', 'danger');
    pushFx(room, { type: 'allOut' });
    pushState(room);
    setTimeout(() => {
      if (!rooms.has(room.code) || room.game.gameOver) return;
      room.game.round++;
      startRound(room);
    }, 3500);
    return true;
  }
  return false;
}

async function redistribute(room) {
  const alive = targetablePlayers(room);
  const owners = new Map();
  let pool = [];
  alive.forEach((p) => { p.hand.forEach((c) => owners.set(c.uid, p.id)); pool.push(...p.hand); p.hand = []; });
  pool = shuffle(pool);
  let i = 0;
  while (pool.length) { alive[i % alive.length].hand.push(pool.pop()); i++; }
  log(room, '全手札をシャッフルして再配布した。', 'rule');
  for (const p of alive) {
    const cursed = p.hand.filter((c) => c.id === 53 && owners.get(c.uid) !== p.id);
    if (cursed.length) await checkCurseReceived(room, p, cursed, '席順変更！');
  }
}

async function trapSafe(room, p) {
  trackTrap(room, 'このカードは安全です', 'ゲーム内の「安全確認」に見せかけたUIトラップ。');
  pushState(room);
  const choice = await askPlayer(room, p.id, {
    title: 'The Cool Soul Security', skin: 'trap', kind: 'trap',
    message: '✓ 推奨セキュリティ確認\n\nゲームの安全確認を完了してください。\nこの操作でカードやポイントが失われることはありません。\n\n※たぶん安全です。',
    options: [{ label: 'あとで確認する', value: 'safe' }, { label: '安全確認を完了する', value: 'danger', primary: true }],
    defaultValue: 'safe'
  });
  room.game.activeTrap = null;
  if (choice === 'danger') await attemptEliminate(room, p, '安全確認を最後まで実行した', null, { allowReflect: false, allowPrevent: true });
}
async function trapRight(room, p) {
  trackTrap(room, '右を見ろ', '右側の大きなボタンへ視線とクリックを誘導するUIトラップ。');
  pushState(room);
  const choice = await askPlayer(room, p.id, {
    title: '表示位置の自動最適化', skin: 'trap-right', kind: 'trap',
    message: '右側の表示領域を最適化できます。\n右のボタンを選ぶとすぐに最適化できます。',
    options: [{ label: '今はしない', value: 'safe' }, { label: '右側を最適化する →', value: 'danger', primary: true }],
    defaultValue: 'safe'
  });
  room.game.activeTrap = null;
  if (choice === 'danger') await attemptEliminate(room, p, '右を見た', null, { allowReflect: false, allowPrevent: true });
}

async function sendChat(room, player, text) {
  const g = room.game;
  if (!player?.alive || player.away || g.roundLocked || !text) return;
  text = String(text).slice(0, 100);
  log(room, `💬 ${player.name}「${text}」`, 'normal');
  const silenceRules = g.rules.filter((r) => r.kind === 'silence');
  if (silenceRules.length) {
    const breaker = await askFirstInterruptHolder(room, 37, '静粛に解除', '今なら《静粛に！》を解除できる。使う？');
    if (breaker) g.rules = g.rules.filter((r) => r.kind !== 'silence');
    else {
      const owner = g.players.find((x) => x.id === silenceRules[0].owner) || null;
      await attemptEliminate(room, player, '《静粛に！》中に発言した', owner, { allowReflect: false });
      pushState(room); return;
    }
  }
  const afterChat = await askFirstInterruptHolder(room, 35, '今しゃべった？', `${player.name}が発言した。手札1枚を捨てさせる？`, { excludeIds: [player.id] });
  if (afterChat) {
    if (!player.hand.length) await attemptEliminate(room, player, '《今しゃべった？》で捨てる手札がない', afterChat.player);
    else {
      const c = await askCardFromHand(room, player, '《今しゃべった？》：1枚捨てる');
      if (c) g.discard.push(player.hand.splice(player.hand.findIndex((x) => x.uid === c.uid), 1)[0]);
    }
  }
  if (/\d/.test(text) && g.rules.some((r) => r.kind === 'banNumbers') && player.hand.length) {
    const c = await askCardFromHand(room, player, '数字は禁止：1枚捨てる');
    if (c) g.discard.push(player.hand.splice(player.hand.findIndex((x) => x.uid === c.uid), 1)[0]);
  }
  if (/[ァ-ヶー]/.test(text) && g.rules.some((r) => r.kind === 'banKatakana')) await drawCard(room, player, false);
  if (g.rules.some((r) => r.kind === 'nameCalling')) {
    const rough = /(お前|君|あなた|あんた|こいつ|そいつ|あいつ)/.test(text);
    const named = g.players.some((x) => text.includes(x.name));
    if (rough && !named && player.hand.length) {
      const c = await askCardFromHand(room, player, '名前で呼んで：1枚捨てる');
      if (c) g.discard.push(player.hand.splice(player.hand.findIndex((x) => x.uid === c.uid), 1)[0]);
    }
  }
  if (g.rules.some((r) => r.kind === 'politeSpeech') && !/(です|ます|でした|ました|ません|ございます)[。！!？?]*$/.test(text)) await drawCard(room, player, false);
  if (g.rules.some((r) => r.kind === 'chatDraw')) {
    const breaker = await askFirstInterruptHolder(room, 86, '喋らないとゲームできないだろ！', '《黙ってゲームしろ》を解除する？');
    if (breaker) g.rules = g.rules.filter((r) => r.kind !== 'chatDraw');
    else await drawCard(room, player, false);
  }
  checkRoundEnd(room);
  pushState(room);
}

async function advanceTurn(room) {
  const g = room.game;
  const prev = currentPlayer(room);
  if (prev) prev.playedThisTurn = 0;
  let guard = 0;
  while (guard < g.players.length + 3) {
    do {
      g.current = (g.current + g.direction + g.players.length) % g.players.length;
      guard++;
    } while (!g.players[g.current].alive && guard < g.players.length + 3);
    const incoming = currentPlayer(room);
    if (!incoming?.alive) break;
    incoming.untargetable = false;
    g.rules = g.rules.filter((r) => r.owner !== incoming.id);
    incoming.playedThisTurn = 0;
    g.drawnThisTurn = false;
    if (incoming.away) {
      incoming.away = false;
      log(room, `🚻 ${incoming.name}が《ちょっとトイレ》から戻ってきた。`, 'rule');
      const blocker = await askFirstInterruptHolder(room, 51, '戻ってこなくていいよ', `${incoming.name}がゲームへ戻ってきた。帰宅させる？`, { excludeIds: [incoming.id] });
      if (blocker) {
        await attemptEliminate(room, incoming, '《戻ってこなくていいよ》', blocker.player, { ignoreAway: true });
        if (checkRoundEnd(room)) return;
        if (!incoming.alive) continue;
      }
    }
    pushState(room);
    return;
  }
  pushState(room);
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function requireRoomAuth(body) {
  const code = String(body.roomCode || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) throw new Error('ルームが見つからないわ。');
  if (!validateAuth(room, body.playerId, body.token)) throw new Error('参加情報が一致しないわ。');
  return room;
}

async function handleAction(room, playerId, action, payload = {}) {
  const g = room.game;
  if (action === 'promptResponse') return;
  if (room.status !== 'playing') throw new Error('まだゲームは始まっていないわ。');
  const player = gamePlayer(room, playerId);
  if (!player) throw new Error('プレイヤーが見つからないわ。');

  if (action === 'chat') {
    await sendChat(room, player, payload.text || '');
    return;
  }
  if (room.busy) throw new Error('いまカード効果の処理中。ちょっと待ちなさい。');
  room.busy = true;
  pushState(room);
  try {
    switch (action) {
      case 'draw': {
        if (currentPlayer(room)?.id !== player.id || g.drawnThisTurn || g.roundLocked || player.away || !player.alive) throw new Error('今は引けないわ。');
        g.drawnThisTurn = true;
        await drawCard(room, player, true);
        checkRoundEnd(room);
        break;
      }
      case 'playCard':
        await playCard(room, player.id, payload.uid);
        break;
      case 'endTurn': {
        if (currentPlayer(room)?.id !== player.id || g.roundLocked || !player.alive) throw new Error('今はターンを終了できないわ。');
        if (!checkRoundEnd(room)) await advanceTurn(room);
        break;
      }
      default:
        throw new Error('知らない操作よ。');
    }
  } finally {
    room.busy = false;
    pushState(room);
  }
}

async function apiHandler(req, res, pathname) {
  try {
    if (req.method === 'POST' && pathname === '/api/create') {
      const body = await readJson(req);
      const room = new Room(body.name);
      rooms.set(room.code, room);
      const host = room.players[0];
      return json(res, 200, { roomCode: room.code, playerId: host.id, token: host.token, state: publicState(room, host.id) });
    }
    if (req.method === 'POST' && pathname === '/api/join') {
      const body = await readJson(req);
      const code = String(body.roomCode || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return json(res, 404, { error: 'ルームが見つからないわ。' });
      if (room.status !== 'lobby') return json(res, 409, { error: 'このルームはもうゲーム中よ。' });
      if (room.players.length >= 8) return json(res, 409, { error: '8人で満員よ。' });
      const p = { id: randomId(), token: randomId(), name: sanitizeName(body.name), connected: true, points: 0, hand: [], alive: true, away: false, untargetable: false, playedThisTurn: 0 };
      room.players.push(p);
      pushState(room);
      return json(res, 200, { roomCode: room.code, playerId: p.id, token: p.token, state: publicState(room, p.id) });
    }
    if (req.method === 'POST' && pathname === '/api/reconnect') {
      const body = await readJson(req);
      const room = requireRoomAuth(body);
      const p = playerOf(room, body.playerId);
      p.connected = true;
      pushState(room);
      return json(res, 200, { state: publicState(room, p.id) });
    }
    if (req.method === 'POST' && pathname === '/api/start') {
      const body = await readJson(req);
      const room = requireRoomAuth(body);
      if (room.hostId !== body.playerId) return json(res, 403, { error: 'ゲーム開始はホストだけよ。' });
      if (room.status !== 'lobby') return json(res, 409, { error: 'もう始まってるわ。' });
      const testMode = body.testMode === true;
      if (testMode) {
        if (room.players.length !== 2) return json(res, 409, { error: '2人テストモードは参加者がちょうど2人の時だけ使えるわ。' });
      } else if (room.players.length < 3) {
        return json(res, 409, { error: '正式ルールでは3人以上必要よ。2人ならテストモードを使って。' });
      }
      startGame(room, testMode);
      return json(res, 200, { ok: true, testMode });
    }
    if (req.method === 'POST' && pathname === '/api/action') {
      const body = await readJson(req);
      const room = requireRoomAuth(body);
      if (body.action === 'promptResponse') {
        const prompt = room.prompts.get(body.payload?.requestId);
        if (!prompt || prompt.playerId !== body.playerId) return json(res, 409, { error: 'その選択はもう有効じゃないわ。' });
        clearTimeout(prompt.timer);
        room.prompts.delete(body.payload.requestId);
        prompt.resolve(body.payload.value);
        return json(res, 200, { ok: true });
      }
      await handleAction(room, body.playerId, body.action, body.payload || {});
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'APIが見つからないわ。' });
  } catch (e) {
    return json(res, 400, { error: e.message || '処理に失敗したわ。' });
  }
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  rel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/events' && req.method === 'GET') {
    const code = String(url.searchParams.get('roomCode') || '').toUpperCase();
    const playerId = url.searchParams.get('playerId') || '';
    const token = url.searchParams.get('token') || '';
    const room = rooms.get(code);
    if (!room || !validateAuth(room, playerId, token)) { res.writeHead(401); return res.end(); }
    const p = playerOf(room, playerId);
    p.connected = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const old = room.streams.get(playerId);
    if (old && old !== res && !old.writableEnded) old.end();
    room.streams.set(playerId, res);
    sseSend(res, 'state', publicState(room, playerId));
    for (const [requestId, prompt] of room.prompts.entries()) {
      if (prompt.playerId === playerId) pushPrompt(room, playerId, prompt.payload || { requestId, title: '選択待ち', message: '進行中の選択があります。', options: [{ label: '何もしない', value: '' }], skin: 'normal', kind: 'choice' });
    }
    req.on('close', () => {
      if (room.streams.get(playerId) === res) room.streams.delete(playerId);
      const pl = playerOf(room, playerId);
      if (pl) pl.connected = false;
      pushState(room);
    });
    return;
  }

  if (pathname.startsWith('/api/')) return apiHandler(req, res, pathname);
  serveStatic(req, res, pathname);
});

setInterval(() => {
  for (const room of rooms.values()) {
    for (const res of room.streams.values()) if (!res.writableEnded) res.write(': ping\n\n');
  }
}, 20000);
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) if (room.createdAt < cutoff && room.streams.size === 0) rooms.delete(code);
}, 15 * 60 * 1000);

server.on('error', (err) => {
  console.error('\n[SERVER ERROR]');
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error('Close the other server/app using this port, then start again.');
  } else if (err && err.code === 'EACCES') {
    console.error(`Permission denied while opening port ${PORT}.`);
  } else {
    console.error(err && err.stack ? err.stack : err);
  }
  process.exitCode = 1;
});

process.on('uncaughtException', (err) => {
  console.error('\n[UNCAUGHT EXCEPTION]');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

process.on('unhandledRejection', (err) => {
  console.error('\n[UNHANDLED REJECTION]');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`The クールソウルゲーム Online Beta: http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const list of Object.values(nets)) for (const net of (list || [])) {
    if (net.family === 'IPv4' && !net.internal) addresses.push(`http://${net.address}:${PORT}`);
  }
  if (addresses.length) {
    console.log('同じWi-Fi / LANの参加URL:');
    addresses.forEach((a) => console.log(`  ${a}`));
  } else {
    console.log('LAN用IPを取得できませんでした。OSの ipconfig / ifconfig でIPを確認してください。');
  }
});
