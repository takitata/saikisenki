/*
 * Card definitions. Values and effect records are kept separate from UI/game logic.
 * Effect records are descriptive data for the planned battle engine; this prototype
 * only renders them. An absent value is not inferred. See unresolved for TBD rules.
 */
(() => {
  const effect = (kind, value, condition = null, extra = {}) => ({ kind, value, ...(condition ? { condition } : {}), ...extra });
  const variant = (kind, value, condition, conditionalValue) => effect(kind, value, null, { conditional: { condition, value: conditionalValue } });
  const support = (...effects) => effects;
  const trigger = (die, ...effects) => ({ die: Array.isArray(die) ? die : [die], effects });
  const card = (id, name, attribute, rarity, hp, dice, supports, options = {}) => ({
    id, name, attribute, rarity, baseHp: hp, dice: [...dice], support: supports,
    triggers: options.triggers || [], passives: options.passives || [],
    unresolved: options.unresolved || [], awakening: options.awakening || null,
    formationRestriction: options.formationRestriction || null, description: options.description || ""
  });

  window.CARD_DATA = [
    // Normal — Red
    card("n-red-warrior","戦士","red","normal",100,[10,15,20,25,35,45],support(variant("damageBonus",15,"currentBattleAttribute:red",20))),
    card("n-red-berserker","狂戦士","red","normal",85,[10,20,30,40,50,60],support(variant("damageBonus",10,"currentHpAtMost:50%",25))),
    card("n-red-dragon","火竜","red","normal",95,[10,15,25,35,45,60],support(effect("damageBonus",20),effect("selfDamage",5)),{triggers:[trigger(6,effect("selfDamage",10))]}),
    card("n-red-archer","弓兵","red","normal",90,[10,15,20,30,40,50],support(effect("damageBonus",10),effect("damageBonus",15,{kind:"handIs",hand:"rock"}))),
    card("n-red-vampire","吸血鬼","red","normal",90,[8,15,22,30,38,50],support(effect("heal",15)),{triggers:[trigger(5,effect("heal",10)),trigger(6,effect("heal",15))]}),
    card("n-red-bomber","砲撃手","red","normal",90,[5,10,15,25,0,80],support(effect("damageBonus",10),effect("damageBonus",15,{kind:"finalDieParity",parity:"even"})),{triggers:[trigger(3,effect("selfDamage",15)),trigger(5,effect("nextRoundRawDieOverride",5))]}),
    card("n-red-knight","赤騎士","red","normal",110,[10,15,20,25,35,45],support(effect("damageReduction",15))),
    card("n-red-pyromancer","炎術師","red","normal",85,[5,15,25,35,45,60],support(variant("damageBonus",15,"currentBattleAttribute:red",20))),
    card("n-red-spearman","槍兵","red","normal",90,[5,5,5,100,10,20],support(effect("dieModifier",1,null,{target:"self"}))),
    card("n-red-phoenix","不死鳥","red","normal",90,[10,15,20,30,40,45],support(effect("heal",15)),{triggers:[trigger(6,effect("revive",50,{source:"graveyard",target:"chosenCard",hpPercent:50}))]}),
    // Normal — Blue
    card("n-blue-mage","魔術師","blue","normal",90,[5,15,20,25,35,40],support(effect("opponentDieModifier",-1),effect("opponentDamageReduction",5,"currentBattleAttribute:blue")),{triggers:[trigger(6,effect("nextRoundOpponentDieModifier",-1))]}),
    card("n-blue-warrior","青戦士","blue","normal",105,[10,15,20,25,30,40],support(effect("damageBonus",15))),
    card("n-blue-knight","青騎士","blue","normal",110,[5,10,20,25,35,40],support(variant("damageReduction",15,"currentBattleAttribute:blue",20)),{triggers:[trigger(6,effect("shield",10))]}),
    card("n-blue-amoeba","アメーバ","blue","normal",105,[5,12,20,28,38,48],support(effect("opponentDieModifier",-1)),{triggers:[trigger(5,effect("nextRoundOpponentDieModifier",-1)),trigger(6,effect("nextRoundOpponentDieModifier",-2))]}),
    card("n-blue-gambler","ギャンブラー","blue","normal",90,[0,0,0,0,120,0],support(effect("reroll",1))),
    card("n-blue-ice-mage","氷術師","blue","normal",90,[5,15,20,30,35,45],support(effect("nextOpponentDamageReduction",15)),{triggers:[trigger(5,effect("nextRoundOpponentDamageReduction",10)),trigger(6,effect("nextRoundOpponentDamageReduction",15))]}),
    card("n-blue-spellsword","魔法剣士","blue","normal",100,[10,15,20,30,35,45],support(effect("dieModifier",1,null,{target:"self"})),{triggers:[trigger(6,effect("nextRoundDieModifier",1,null,{target:"self"}))]}),
    card("n-blue-golem","ゴーレム","blue","normal",120,[5,10,15,20,25,35],support(effect("damageReduction",15)),{triggers:[trigger(4,effect("shield",5)),trigger(5,effect("shield",10)),trigger(6,effect("shield",15))]}),
    card("n-blue-time-mage","時間術師","blue","normal",85,[8,15,20,30,40,50],support(effect("rawDieOverride",5,null,{target:"self"})),{triggers:[trigger(1,effect("nextRoundDieModifier",2,null,{target:"self"})),trigger(2,effect("nextRoundDieModifier",1,null,{target:"self"}))],description:"サポート：そのラウンドの補正前ダイスを5にする。"}),
    card("n-blue-hexer","呪術師","blue","normal",85,[5,10,20,30,40,45],support(effect("opponentDieModifier",-1)),{triggers:[trigger([5,6],effect("nextRoundOpponentDieModifier",-1))]}),
    // Normal — Green
    card("n-green-guard","守護兵","green","normal",120,[5,10,15,20,25,35],support(variant("damageReduction",15,"currentBattleAttribute:green",20))),
    card("n-green-healer","ヒーラー","green","normal",95,[5,10,15,20,25,30],support(variant("heal",20,"currentBattleAttribute:green",30)),{triggers:[trigger(5,effect("heal",10)),trigger(6,effect("heal",20))]}),
    card("n-green-warrior","緑戦士","green","normal",110,[10,15,20,25,30,40],support(effect("damageBonus",15))),
    card("n-green-tree","毒キノコ","green","normal",95,[10,15,20,30,40,55],support(effect("damageBonus",10),effect("opponentDamageReduction",10))),
    card("n-green-spirit","精霊","green","normal",100,[10,15,20,25,35,40],support(effect("heal",15)),{triggers:[trigger(1,effect("heal",10)),trigger(2,effect("heal",5)),trigger(6,effect("revive",50,{source:"graveyard",target:"chosenCard",hpPercent:50}))]}),
    card("n-green-monk","モンク","green","normal",105,[10,15,20,25,30,40],support(effect("damageBonus",10),effect("heal",10)),{triggers:[trigger(5,effect("heal",5)),trigger(6,effect("heal",10))]}),
    card("n-green-treant","トレント","green","normal",130,[5,10,15,20,25,30],support(effect("heal",20)),{triggers:[trigger(5,effect("heal",5)),trigger(6,effect("heal",10))]}),
    card("n-green-ranger","レンジャー","green","normal",100,[10,15,20,25,35,45],support(effect("reroll",1))),
    card("n-green-beetle-knight","甲虫騎士","green","normal",120,[5,10,20,25,30,35],support(effect("damageReduction",15)),{triggers:[trigger(5,effect("shield",10)),trigger(6,effect("shield",15))]}),
    card("n-green-priest","森の司祭","green","normal",90,[5,10,15,20,30,35],support(variant("heal",20,"currentBattleAttribute:green",25)),{triggers:[trigger(6,effect("revive",50,{source:"graveyard",target:"chosenCard",hpPercent:50}))]}),
    // Normal — White
    card("n-white-adventurer","冒険者","white","normal",95,[10,15,20,25,30,40],support(effect("reroll",1))),
    card("n-white-warrior","白戦士","white","normal",100,[10,15,20,25,30,40],support(variant("damageBonus",10,"currentBattleAttribute:white",15))),
    card("n-white-knight","白騎士","white","normal",110,[5,10,15,20,25,35],support(variant("damageReduction",10,"currentBattleAttribute:white",15))),
    card("n-white-mage","白魔導師","white","normal",90,[5,10,15,20,25,30],support(variant("heal",15,"currentBattleAttribute:white",20)),{triggers:[trigger(5,effect("heal",10)),trigger(6,effect("heal",15))]}),
    card("n-white-sage","賢者","white","normal",85,[5,15,20,25,35,40],support(effect("dieModifier",1,null,{target:"self"})),{triggers:[trigger(6,effect("nextRoundDieModifier",1,null,{target:"self"}))]}),
    card("n-white-trickster","トリックスター","white","normal",90,[0,5,10,15,20,60],support(effect("opponentDieModifier",-1)),{triggers:[trigger(1,effect("selfDamage",15)),trigger(4,effect("heal",20)),trigger(5,effect("shield",20))]}),
    card("n-white-mercenary","傭兵","white","normal",100,[10,15,20,25,35,45],support(effect("damageBonus",10),effect("damageBonus",10,{kind:"rpsResult",result:"win"}))),
    card("n-white-monk","旅の僧侶","white","normal",100,[10,15,20,25,30,35],support(variant("heal",10,"currentBattleAttribute:white",15)),{triggers:[trigger(5,effect("heal",5)),trigger(6,effect("heal",10))]}),
    card("n-white-clown","ピエロ","white","normal",85,[65,25,18,12,6,0],support(effect("reroll",1))),
    card("n-white-summoner","召喚士","white","normal",85,[5,10,15,20,30,35],support(effect("heal",15)),{triggers:[trigger(6,effect("revive",50,{source:"graveyard",target:"chosenCard",hpPercent:50}))]}),
    // Rare — Red
    card("r-red-revenge-knight","復讐騎士","red","rare",120,[15,20,25,30,40,50],support(variant("damageBonus",20,"currentBattleAttribute:red",30)),{passives:[effect("damageBonusPerGraveyardBattleCard",5,{attribute:"red"},{maximum:15,label:"復讐"})]}),
    card("r-red-reverse-swordsman","逆刃の剣士","red","rare",110,[15,20,30,35,45,55],support(effect("damageBonus",25)),{passives:[effect("damageBonus",20,{condition:"rockPaperScissorsWin",hand:"scissors"},{label:"逆刃"})]}),
    card("r-red-fist-king","拳王","red","rare",115,[15,20,25,30,40,50],support(variant("damageBonus",20,"currentHpAtMost:50%",30)),{passives:[effect("damageBonusPerRockUse",5,{scope:"thisCard",hand:"rock",cap:null},{label:"蓄積"})]}),
    // Rare — Blue
    card("r-blue-sea-king","海王","blue","rare",120,[10,20,25,30,40,50],support(variant("damageReduction",20,"currentBattleAttribute:blue",30)),{passives:[effect("maxHpBonusPerOtherBattleCard",10,{attribute:"blue",timing:"battleStart"},{label:"海王の加護"})]}),
    card("r-blue-sealer","封印術師","blue","rare",115,[10,15,25,30,40,50],support(effect("opponentDieModifier",-1),effect("opponentDamageReduction",10)),{passives:[effect("disableOpponentSupportNextRound",1,{condition:"rockPaperScissorsWin",hand:"paper"},{label:"封印"})]}),
    card("r-blue-illusionist","不屈の闘士","blue","rare",130,[5,10,15,20,30,40],support(effect("damageReduction",20),effect("damageReduction",10,{kind:"rpsResult",result:"loss"})),{passives:[effect("damageBonusPerRpsLoss",10,null,{label:"不屈"})]}),
    // Rare — Green
    card("r-green-paladin","聖騎士","green","rare",125,[10,20,25,30,40,45],support(variant("heal",20,"currentBattleAttribute:green",30)),{passives:[effect("heal",10,{condition:"rockPaperScissorsWin"},{label:"聖なる癒し"})]}),
    card("r-green-great-fairy","大妖精","green","rare",120,[10,15,20,25,35,40],support(effect("heal",25),effect("damageReduction",10,null,{duration:"thisRound"})),{triggers:[trigger(6,effect("revive",100,{source:"graveyard",target:"chosenCard",hpPercent:100,usesPerBattle:1}))]}),
    card("r-green-beast-king","獣王","green","rare",120,[15,20,25,30,40,50],support(variant("heal",20,"currentHpAtMost:50%",30)),{passives:[effect("damageBonus",15,"currentHpAtMost:50%",{label:"獣王"})]}),
    // Rare — White
    card("r-white-sword-saint","剣聖","white","rare",115,[15,20,25,30,40,50],support(variant("damageBonus",20,"currentBattleAttribute:white",30)),{passives:[effect("formationScaling",{5:{hp:115,damageBonus:0},4:{hp:145,damageBonus:15},3:{hp:165,damageBonus:20},2:{hp:180,damageBonus:25},1:{hp:220,damageBonus:30}},{timing:"battleStart",key:"battleCardCount"},{label:"剣聖"})],description:"編成枚数で最大HPとダメージ補正が変化。"}),
    card("r-white-hunter","狩人","white","rare",115,[10,15,20,25,35,45],support(effect("damageBonus",20),effect("reroll",1)),{passives:[effect("damageBonusPerOpponentBattleCardRemaining",{5:15,4:10,3:5,2:0,1:0},null,{label:"狩猟本能"})]}),
    card("r-white-arbiter","調停者","white","rare",120,[15,20,30,35,45,55],support(effect("suppressRpsDieModifier",1,{scope:"bothPlayers",duration:"thisRound"})),{passives:[effect("suppressRpsDieModifier",1,{scope:"bothPlayers",while:"thisCardIsCurrentBattleCard"},{label:"調停"})],description:"じゃんけん結果そのもの、得意手勝利ボーナス、および条件付き能力は通常通り。"}),
    // Legends — excluded from regular random rosters; available in manual test pools.
    card("l-red-suzaku","朱雀","red","legend",50,[5,10,15,20,25,30],support(effect("revive",100,{source:"graveyard",target:"chosenCard",hpPercent:100})),{
      awakening:{kind:"reviveAfterKnockout",maxHp:180,dice:[25,30,40,45,55,60],hpPolicy:"full",triggers:[trigger(6,effect("heal",40))],label:"朱雀"},
      description:"雛の状態でKOされた後、蘇生に成功すると全回復して朱雀に覚醒。覚醒後の出目6で自身を40回復。"
    }),
    card("l-blue-seiryu","青龍","blue","legend",90,[10,15,20,25,30,35],support(effect("damageBonus",50),effect("damageBonus",30,{kind:"rpsResult",result:"win",hand:"paper"})),{
      awakening:{kind:"teamPaperWins",threshold:3,maxHp:170,dice:[35,45,50,60,70,80],hpPolicy:"preserveDamage",label:"青龍"},
      description:"味方全体のパー勝利が累計3回になると、ラウンド終了後に覚醒。覚醒時点の被ダメージ量を引き継ぐ。"
    }),
    card("l-green-genbu","玄武","green","legend",100,[5,10,15,20,25,30],support(effect("damageBonus",30),effect("damageReduction",30)),{
      awakening:{kind:"teamRpsLosses",threshold:5,maxHp:200,dice:[20,25,30,35,40,50],hpPolicy:"preserveDamage",label:"玄武",passives:[effect("damageReduction",10)],triggers:[trigger(5,effect("damageReduction",5)),trigger(6,effect("damageReduction",10))]},
      description:"味方全体のじゃんけん敗北が累計5回になると覚醒。覚醒時点の被ダメージ量を引き継ぐ。覚醒後は常時被ダメージ-10。出目5/6はそのラウンドさらに軽減。"
    }),
    card("l-white-byakko","白虎","white","legend",150,[35,40,50,55,65,75],support(effect("rawDieOverride",6,null,{target:"self"}),effect("damageBonus",40)),{
      passives:[effect("immuneToDamageOnRpsWin",1,{scope:"thisCard"},{label:"白虎"})],
      formationRestriction:{battleCardCount:1,exclusive:true},
      description:"バトル編成は白虎1体のみ。じゃんけん勝利ラウンドは受けるダメージをすべて0にする。"
    })
  ];

  window.CARD_ATTRIBUTE_LABELS = { red: "赤", blue: "青", green: "緑", white: "白" };
  window.CARD_RARITY_LABELS = { normal: "NORMAL", rare: "RARE", legend: "LEGEND" };
})();
