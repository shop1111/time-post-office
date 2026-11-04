/**
 * 示例人生：林小满，27 岁，在杭州做 UI 设计师，养了一只叫「年糕」的猫，在学胶片摄影。
 * 时间全部相对「现在」计算，保证任何时候载入都能演示（不需要快进时间）：
 *  - 刚载入：最近一周情绪低落 → 小局来信安慰；半年前写给未来自己的信今天送达
 *  - 之后几天：大理旅行刚满 90 天、认证考试昨天到期 → 小局会陆续来信回顾、追问结果
 *  - 收件人「小鹿」：有一组往来信件，还有一封回信正在路上
 */
import type { EntityType, MemoryKind } from "@/lib/types";

type Ent = [string, EntityType];
export interface DemoMemory {
  kind: MemoryKind;
  content: string;
  importance: number;
  entities: Ent[];
  dueInDays?: number; // 相对「现在」
  resolved?: boolean;
}
export interface DemoEntry {
  key: string;
  daysAgo: number;
  hour: number;
  type: "photo" | "voice" | "text";
  text: string;
  place?: string;
  scene?: string;
  caption?: string;
  mood: number;
  emotions: string[];
  title: string;
  summary: string;
  memories: DemoMemory[];
  chat?: Array<["user" | "assistant", string]>;
  card?: { title: string; narrative: string; quote: string; template?: string };
}

export const EXAM_IN_DAYS = -1;

const ME: Ent = ["年糕", "person"];
const MOM: Ent = ["妈妈", "person"];
const LU: Ent = ["小鹿", "person"];
const ZHE: Ent = ["阿哲", "person"];
const HZ: Ent = ["杭州", "place"];
const WL: Ent = ["西湖", "place"];
const DL: Ent = ["大理", "place"];
const EH: Ent = ["洱海", "place"];
const PHOTO: Ent = ["胶片摄影", "theme"];
const WORK: Ent = ["工作", "theme"];

export const DEMO_ENTRIES: DemoEntry[] = [
  {
    key: "move", daysAgo: 178, hour: 21, type: "text", place: "杭州",
    text: "终于搬完家了！累到不想动。但是看到阳台外面的夕阳，觉得一切都值得吧。年糕在纸箱里钻来钻去，哈哈哈，它比我还兴奋。新的城市，慢慢来。",
    mood: 0.6, emotions: ["疲惫", "期待", "开心"], title: "杭州·新家第一天", summary: "搬进杭州的新家，累但满足，猫咪年糕很兴奋。",
    memories: [
      { kind: "event", content: "搬到杭州的新家，阳台能看到夕阳", importance: 8, entities: [HZ, ME] },
      { kind: "fact", content: "养了一只叫年糕的猫", importance: 6, entities: [ME] },
    ],
    card: { title: "阳台上的第一场夕阳", narrative: "纸箱还堆在客厅，胶带的声音还在耳朵里。你瘫坐在阳台的地板上，看着陌生城市的太阳一点点沉下去。年糕从一个纸箱钻进另一个纸箱，好像这里早就是它的家。那一刻你忽然觉得，新的开始不需要很隆重，有一场夕阳、一只猫，就够了。", quote: "新的城市，慢慢来。", template: "paper" },
  },
  {
    key: "bike", daysAgo: 170, hour: 16, type: "photo", place: "西湖", scene: "westlake-bike",
    caption: "湖边的林荫道，柳树垂到水面，远处有一座小桥，阳光很好。",
    text: "和小鹿沿着西湖骑车，风好舒服！从断桥骑到苏堤，柳树一直垂到水里。小鹿说我来杭州以后笑得比以前多了，真的吗？",
    mood: 0.8, emotions: ["放松", "开心", "自由"], title: "西湖·和小鹿骑车", summary: "和好友小鹿沿西湖骑行，从断桥到苏堤，非常放松。",
    memories: [
      { kind: "event", content: "和小鹿沿西湖从断桥骑到苏堤", importance: 7, entities: [LU, WL] },
      { kind: "fact", content: "小鹿是在杭州最好的朋友，说小满来杭州后笑得更多了", importance: 7, entities: [LU] },
    ],
    chat: [
      ["assistant", "这张照片的光线好温柔，柳条都要碰到水面了。那天是和谁一起？按下快门的那一刻在想什么？"],
      ["user", "和小鹿！她是我在杭州最好的朋友。拍的时候在想，原来周末可以这么慢。"],
      ["assistant", "原来是这样，周末可以这么慢，难怪你会记住。小鹿说你笑得比以前多了——你自己觉得呢？"],
      ["user", "好像是吧。以前在老家总觉得很憋，来这边虽然累但是自由。"],
      ["assistant", "「来这边虽然累但是自由」——谢谢你愿意把这些讲给我听。我把西湖的这一页好好收进时光邮局了。"],
    ],
    card: { title: "从断桥到苏堤", narrative: "风从湖面上吹过来，带着一点水汽。小鹿骑在前面，时不时回头冲你喊什么，你没听清，只是跟着笑。柳条一直垂到水里，阳光碎在湖面上。你忽然意识到，原来周末可以这么慢——不用赶路，不用回消息，只需要一直往前骑。", quote: "原来周末可以这么慢。", template: "postcard" },
  },
  {
    key: "momcall1", daysAgo: 160, hour: 22, type: "voice",
    text: "妈妈今天打电话来，问我吃饭没有，有没有按时睡觉。说着说着就说想我了。挂了电话有点想家……其实我也想她。",
    mood: -0.2, emotions: ["思念", "温暖"], title: "妈妈的电话", summary: "妈妈来电关心起居，说想她了，挂电话后有点想家。",
    memories: [{ kind: "event", content: "妈妈打电话说想她，挂电话后有点想家", importance: 6, entities: [MOM] }],
  },
  {
    key: "camera", daysAgo: 150, hour: 20, type: "text", place: "杭州",
    text: "买了人生第一台胶片相机！二手的，有点旧，但是快门声音好好听呀。希望明年能办一次自己的小摄影展，哪怕只有朋友来看也好。",
    mood: 0.7, emotions: ["期待", "开心"], title: "第一台胶片相机", summary: "买了第一台二手胶片相机，希望明年办一次自己的小摄影展。",
    memories: [
      { kind: "event", content: "买了人生第一台二手胶片相机", importance: 7, entities: [PHOTO] },
      { kind: "goal", content: "希望明年能办一次自己的小摄影展", importance: 9, entities: [PHOTO] },
    ],
  },
  {
    key: "praise", daysAgo: 141, hour: 19, type: "text",
    text: "第一次独立负责的项目上线了！老板在周会上点名夸了我。救命，当时脸都红了。晚上奖励自己一杯奶茶。",
    mood: 0.8, emotions: ["自豪", "开心"], title: "第一次独立负责的项目", summary: "独立负责的项目上线，被老板在周会上表扬。",
    memories: [{ kind: "event", content: "第一次独立负责的项目上线，被老板在周会上点名表扬", importance: 8, entities: [WORK] }],
  },
  {
    key: "catsun", daysAgo: 133, hour: 14, type: "photo", place: "杭州", scene: "cat-sun",
    caption: "一只橘白相间的猫侧躺在洒满阳光的木地板上，眯着眼睛。",
    text: "年糕在阳光里睡成一张饼。周日下午什么都不想干，就陪它躺着吧。",
    mood: 0.6, emotions: ["治愈", "放松"], title: "晒太阳的年糕", summary: "周日下午陪猫咪年糕晒太阳。",
    memories: [{ kind: "event", content: "周日下午陪年糕在阳光里躺着", importance: 4, entities: [ME] }],
    card: { title: "一张饼的下午", narrative: "阳光斜斜地铺在木地板上，年糕把自己摊成一张饼，肚皮一起一伏。你本来想去洗衣服，后来想了想，算了。你躺在它旁边，听着楼下有人在练琴，什么都没做，也什么都不缺。", quote: "什么都没做，也什么都不缺。", template: "postcard" },
  },
  {
    key: "insomnia", daysAgo: 125, hour: 2, type: "text",
    text: "又失眠了。感觉自己什么都做不好，改了八版的稿子还是被打回来。是不是我根本不适合这行……好累。",
    mood: -0.7, emotions: ["焦虑", "迷茫", "疲惫"], title: "凌晨两点的怀疑", summary: "稿子被反复打回，失眠，怀疑自己是否适合设计行业。",
    memories: [{ kind: "event", content: "稿子改了八版仍被打回，失眠并怀疑自己是否适合做设计", importance: 7, entities: [WORK] }],
  },
  {
    key: "hotpot", daysAgo: 122, hour: 21, type: "photo", place: "杭州", scene: "hotpot",
    caption: "一锅红油火锅冒着热气，周围摆满了菜。",
    text: "小鹿知道我心情不好，拉我去吃火锅。她讲了她实习时被骂哭的故事，救命，笑到肚子疼。哈哈哈，好像也没那么糟。",
    mood: 0.6, emotions: ["温暖", "开心"], title: "小鹿的火锅", summary: "心情低落时小鹿拉着去吃火锅，被逗笑，感觉好多了。",
    memories: [{ kind: "event", content: "心情低落时小鹿拉着去吃火锅安慰她", importance: 7, entities: [LU] }],
  },
  {
    key: "mombday", daysAgo: 112, hour: 20, type: "voice",
    text: "今天妈妈生日，给她寄了一条围巾。视频的时候她一直摸着围巾说好软，说着说着眼睛就红了。我也差点哭了。",
    mood: 0.4, emotions: ["感动", "思念"], title: "妈妈的生日", summary: "给妈妈寄了围巾作生日礼物，视频时妈妈感动落泪。",
    memories: [
      { kind: "event", content: "妈妈生日，寄了一条围巾，视频时妈妈感动得眼睛红了", importance: 8, entities: [MOM] },
    ],
  },
  {
    key: "firstroll", daysAgo: 104, hour: 18, type: "text",
    text: "第一卷胶卷洗出来了！36 张只有 5 张能看，哈哈哈。但是那 5 张我好喜欢呀，尤其是年糕打哈欠那张。",
    mood: 0.7, emotions: ["开心", "满足"], title: "第一卷胶卷", summary: "第一卷胶卷冲洗出来，36张里5张满意。",
    memories: [{ kind: "event", content: "第一卷胶卷洗出来，36 张里只有 5 张能看，但很喜欢", importance: 6, entities: [PHOTO, ME] }],
  },
  {
    key: "planDali", daysAgo: 99, hour: 23, type: "text",
    text: "订好票了！下周和阿哲去大理！要带上胶片相机，拍洱海的日出。",
    mood: 0.8, emotions: ["期待"], title: "要去大理啦", summary: "和阿哲约好下周去大理旅行，计划拍洱海日出。",
    memories: [{ kind: "plan", content: "下周和阿哲去大理，计划拍洱海日出", importance: 7, entities: [ZHE, DL, EH], dueInDays: -92, resolved: true }],
  },
  {
    key: "erhai", daysAgo: 91, hour: 6, type: "photo", place: "洱海", scene: "erhai-sunrise",
    caption: "清晨的湖面被染成橘粉色，太阳刚从远山后升起，湖边有一根木桩和一只小船。",
    text: "五点半爬起来等日出。太阳出来那一刻，整个洱海都变成粉色的了！阿哲在旁边一直说「快拍快拍」，我手都在抖。这是我见过最好看的日出。",
    mood: 0.95, emotions: ["惊艳", "幸福", "自由"], title: "洱海·粉色的日出", summary: "和阿哲在洱海边等到了日出，整个湖面变成粉色，是见过最美的日出。",
    memories: [
      { kind: "event", content: "和阿哲五点半起床在洱海等日出，整个湖面变成粉色，是她见过最好看的日出", importance: 9, entities: [ZHE, EH, DL, PHOTO] },
      { kind: "place", content: "洱海是她心里最美的地方", importance: 7, entities: [EH] },
    ],
    chat: [
      ["assistant", "光看照片就觉得那天很值得被记住。湖面这个粉色太梦幻了——那天是和谁一起？按下快门的那一刻在想什么？"],
      ["user", "和阿哲！他比我还激动哈哈哈。我在想，要是能一直这样就好了。"],
      ["assistant", "「要是能一直这样就好了」——这句话好珍贵。有没有一个小细节，是你特别不想忘掉的？"],
      ["user", "他把外套披在我身上，然后自己冻得一直跺脚。"],
      ["assistant", "外套和跺脚的阿哲，我记住了。谢谢你愿意把这些讲给我听，洱海的这颗胶囊已经好好收进时光邮局了，等哪天你想回来看看，它会一直在这里。"],
    ],
    card: { title: "粉色的五点四十分", narrative: "天还没亮，湖边的风冷得刺骨。阿哲把外套披在你身上，自己在旁边一直跺脚。然后太阳出来了——先是一道金边，接着整片洱海都被染成了粉色。他在旁边喊「快拍快拍」，你的手在抖，不知道是因为冷，还是因为太美。你在心里悄悄说：要是能一直这样就好了。", quote: "要是能一直这样就好了。", template: "postcard" },
  },
  {
    key: "cangshan", daysAgo: 90, hour: 19, type: "photo", place: "大理", scene: "cangshan-dusk",
    caption: "黄昏时分，远山层叠，近处是古城的屋檐剪影，亮着暖黄色的灯。",
    text: "在古城的城墙上看苍山日落。阿哲说，以后每年都要一起出来走走。我说好呀，拉钩。",
    mood: 0.9, emotions: ["幸福", "温暖"], title: "大理·古城日落", summary: "在大理古城墙上看苍山日落，和阿哲约定每年一起旅行。",
    memories: [
      { kind: "event", content: "在大理古城墙上看苍山日落", importance: 7, entities: [DL, ZHE] },
      { kind: "goal", content: "和阿哲约定以后每年都要一起出去旅行", importance: 8, entities: [ZHE] },
    ],
    card: { title: "拉钩", narrative: "城墙的砖还留着白天的温度。苍山的轮廓一层一层地暗下去，古城的灯一盏一盏亮起来。阿哲说，以后每年都要一起出来走走。你说好呀，然后伸出小拇指。很幼稚，但你是认真的。", quote: "以后每年都要一起出来走走。", template: "film" },
  },
  {
    key: "backhome", daysAgo: 88, hour: 22, type: "text", place: "杭州",
    text: "回来第一天就开始想念洱海的风了。翻了一晚上照片，其实……有点舍不得回到上班的日子吧。",
    mood: 0.1, emotions: ["思念", "失落"], title: "旅行后遗症", summary: "从大理回来，想念洱海，有点不想回到上班状态。",
    memories: [{ kind: "event", content: "从大理回来后很想念洱海的风，舍不得回去上班", importance: 5, entities: [EH] }],
  },
  {
    key: "momvisit", daysAgo: 72, hour: 21, type: "text", place: "西湖",
    text: "妈妈来杭州看我了！带她逛了西湖，她走两步就要拍一张照，比我还像游客哈哈哈。晚上她偷偷把我冰箱塞满了。",
    mood: 0.8, emotions: ["温暖", "开心"], title: "妈妈来杭州", summary: "妈妈来杭州探望，一起逛西湖，偷偷塞满了冰箱。",
    memories: [
      { kind: "event", content: "妈妈来杭州看她，一起逛西湖，还偷偷把冰箱塞满了", importance: 8, entities: [MOM, WL, HZ] },
    ],
    chat: [
      ["assistant", "读完有点被触动，冰箱被塞满这个细节太有妈妈的味道了。那一刻你身边有谁？"],
      ["user", "就我和妈妈。我站在冰箱前面半天没说话。"],
      ["assistant", "原来是这样，站在冰箱前半天没说话，难怪你会记住。这件事对现在的你来说，意味着什么？"],
      ["user", "意味着不管我走多远，都有人惦记着我吧。"],
      ["assistant", "「不管走多远，都有人惦记着」——我把这一页好好收进时光邮局了。"],
    ],
    card: { title: "被塞满的冰箱", narrative: "妈妈在西湖边走两步就要停下来拍一张照，比你还像游客。你笑她，她也不理你。晚上她走了以后，你打开冰箱——饺子、腊肉、切好的水果，每一格都被塞得满满的。你站在冰箱前面，很久没有说话。不管你走多远，总有人惦记着你。", quote: "不管走多远，都有人惦记着我。", template: "paper" },
  },
  {
    key: "osmanthus", daysAgo: 63, hour: 8, type: "photo", place: "杭州", scene: "osmanthus",
    caption: "枝叶间开满了细碎的金黄色小花。",
    text: "杭州的桂花开了，上班路上整条街都是甜的。今天决定不坐地铁了，走路去公司。",
    mood: 0.7, emotions: ["治愈", "开心"], title: "满城桂花香", summary: "杭州桂花盛开，决定步行上班。",
    memories: [{ kind: "preference", content: "最喜欢杭州桂花开的季节，会为了闻桂花走路上班", importance: 5, entities: [HZ] }],
    card: { title: "甜的街", narrative: "空气是甜的。你走出地铁站，又走了回来——今天不坐地铁了。整条街的桂花都开了，细碎的金黄落在肩膀上，你一路走一路深呼吸，像在偷偷收集什么。原来上班的路，也可以是一段散步。", quote: "上班路上整条街都是甜的。", template: "postcard" },
  },
  {
    key: "zhebday", daysAgo: 48, hour: 23, type: "voice",
    text: "今天是阿哲生日，偷偷做了一本小相册，里面全是大理拍的胶片照。他翻到洱海日出那张的时候，沉默了好久。",
    mood: 0.85, emotions: ["幸福", "感动"], title: "给阿哲的相册", summary: "阿哲生日，送了一本大理胶片照相册，他看到洱海日出那张很感动。",
    memories: [{ kind: "event", content: "阿哲生日，送了一本大理胶片照做的小相册，他看到洱海日出那张沉默了很久", importance: 8, entities: [ZHE, PHOTO, EH] }],
  },
  {
    key: "exam", daysAgo: 40, hour: 22, type: "text",
    text: "报名了 UX 设计认证考试，{examDate} 考。有点怕，但是这次一定要过！慢慢来吧，每天学一个小时。",
    mood: 0.3, emotions: ["期待", "压力"], title: "报名认证考试", summary: "报名了 UX 设计认证考试，计划每天学习一小时。",
    memories: [
      { kind: "plan", content: "报名了 UX 设计认证考试，{examDate} 考试，计划每天学一小时", importance: 8, entities: [WORK], dueInDays: EXAM_IN_DAYS },
      { kind: "goal", content: "这次 UX 设计认证考试一定要过", importance: 7, entities: [WORK] },
    ],
  },
  {
    key: "exhibition", daysAgo: 33, hour: 17, type: "photo", place: "杭州", scene: "gallery",
    caption: "白墙展厅里挂着三幅装裱好的摄影作品，一个人站在中间静静看着。",
    text: "和小鹿去看了一个摄影展。站在一张老街的照片前面看了好久。小鹿说：「下一次就是你的展了。」好像真的有点想认真试试了。",
    mood: 0.6, emotions: ["触动", "期待"], title: "别人的摄影展", summary: "和小鹿看摄影展，小鹿鼓励她办自己的展。",
    memories: [
      { kind: "event", content: "和小鹿去看摄影展，小鹿说下一次就是她的展了", importance: 7, entities: [LU, PHOTO] },
    ],
    card: { title: "下一次就是你的展了", narrative: "展厅很安静，只有脚步声。你在一张老街的照片前站了很久——斑驳的墙，晾着的衣服，一只走过的猫。小鹿走过来，站在你旁边，小声说：下一次就是你的展了。你笑着说别闹，心里却悄悄记下了这句话。", quote: "下一次就是你的展了。", template: "film" },
  },
  {
    key: "momcall2", daysAgo: 25, hour: 21, type: "voice",
    text: "妈妈说外婆最近总念叨我，问我过年回不回家。我说一定回。好久没吃外婆做的酥肉了。",
    mood: 0.3, emotions: ["思念", "温暖"], title: "外婆在念叨我", summary: "妈妈说外婆想她了，答应过年一定回家。",
    memories: [
      { kind: "plan", content: "答应妈妈过年一定回家看外婆", importance: 7, entities: [MOM, ["外婆", "person"]], dueInDays: 95 },
    ],
  },
  {
    key: "overtime", daysAgo: 12, hour: 23, type: "text",
    text: "新项目要上线，连续加班第五天。回到家年糕已经睡了。好累，好久没拿相机了。",
    mood: -0.5, emotions: ["疲惫", "失落"], title: "加班第五天", summary: "新项目上线前连续加班，很累，很久没拍照了。",
    memories: [{ kind: "event", content: "新项目上线前连续加班五天，很久没拿相机了", importance: 6, entities: [WORK, PHOTO] }],
  },
  {
    key: "anxious", daysAgo: 5, hour: 2, type: "text",
    text: "上线前一晚又失眠了。脑子里一直在过需求。有点崩溃，又怕考试来不及复习……算了，先睡吧，睡不着也要躺着。",
    mood: -0.7, emotions: ["焦虑", "疲惫", "崩溃"], title: "上线前夜", summary: "项目上线前夜失眠，担心考试复习不完，压力很大。",
    memories: [{ kind: "event", content: "项目上线前夜失眠，担心认证考试来不及复习", importance: 6, entities: [WORK] }],
  },
  {
    key: "cried", daysAgo: 2, hour: 22, type: "voice",
    text: "今天被老板当着大家的面说设计不够细。回家路上没忍住哭了。到家年糕过来蹭了蹭我，好像知道一样。",
    mood: -0.6, emotions: ["委屈", "难过"], title: "回家路上哭了", summary: "被老板当众批评设计不够细致，回家路上哭了，猫咪年糕来安慰。",
    memories: [
      { kind: "event", content: "被老板当众说设计不够细，回家路上哭了，年糕蹭她安慰", importance: 7, entities: [WORK, ME] },
    ],
  },
];

export interface DemoCorrespondent {
  key: string;
  name: string;
  relation: string;
  moment: string;
  momentDaysAgo: number;
  voice: string;
}

export const DEMO_CORRESPONDENTS: DemoCorrespondent[] = [
  {
    key: "lu",
    name: "小鹿",
    relation: "来杭州以后认识的同事，后来成了最好的朋友",
    moment: "刚来杭州那阵子我谁也不认识，是她周末拉我从断桥骑车到苏堤，我第一次觉得这座城市可以慢下来",
    momentDaysAgo: 170,
    voice: "爽朗、话多，爱用感叹号，叫我「满满」",
  },
];

export interface DemoLetter {
  key: string | null;
  /** user = 小满写的；curator = 小局；persona = agent 以收件人身份代笔 */
  sender: "curator" | "persona" | "user";
  /** 往来的另一方：curator / future_self / 示例收件人的 key */
  to: string;
  triggerType: string;
  subject: string;
  body: string;
  reason: string;
  writtenDaysAgo: number;
  deliverDaysAgo: number; // 负数 = 未来送达；0 = 刚刚送达
  read: boolean;
  /** 小满对这封信的回信 */
  reply?: string;
  citeKeys?: string[]; // 引用哪些胶囊的记忆
  /** 这是哪封示例信的回信（按 subject 对应） */
  inReplyTo?: string;
  /** 小满寄出的信：代笔回信还要多少小时送达 */
  replyInHours?: number;
}

export const DEMO_LETTERS: DemoLetter[] = [
  {
    key: "welcome", sender: "curator", to: "curator", triggerType: "welcome", subject: "欢迎来到时光邮局", writtenDaysAgo: 178, deliverDaysAgo: 178, read: true,
    reason: "你放进了第一颗胶囊",
    body: "小满，你好：\n\n我是时光邮局的主理人，你可以叫我小局。从今天起，你放进来的每一张照片、每一段话、每一行字，我都会好好保管。\n\n我不会催你每天都来。想起来的时候，随手放一颗胶囊就好。想对谁说点什么，也可以写信——写给帮过你的人、写给未来的自己，都可以。\n\n新的城市，慢慢来。\n\n—— 小局",
    citeKeys: ["move"],
  },
  {
    key: "anniv:bike:30", sender: "curator", to: "curator", triggerType: "anniversary", subject: "还记得西湖边的风吗", writtenDaysAgo: 140, deliverDaysAgo: 140, read: true,
    reason: "一个月前的今天，你记录了「西湖·和小鹿骑车」",
    body: "小满，见字如面：\n\n一个月前的今天，你和小鹿从断桥骑到了苏堤。你说「原来周末可以这么慢」，还说来杭州以后虽然累，但是自由。\n\n这一个月你过得怎么样？还有在周末慢下来吗？\n\n—— 小局",
    reply: "最近有点忙，但是这周末打算再去骑一次！谢谢你还记得。", citeKeys: ["bike"],
  },
  {
    key: "mood:seed-1", sender: "curator", to: "curator", triggerType: "low_mood", subject: "给凌晨两点的你", writtenDaysAgo: 124, deliverDaysAgo: 124, read: true,
    reason: "那一周你的胶囊里有些低落",
    body: "亲爱的小满：\n\n昨晚那颗胶囊我看到了。改了八版的稿子被打回来，你在想自己是不是根本不适合这行。\n\n我没法替你回答这个问题，但我记得你为了一个像素失眠的样子——这种在意，本身就很珍贵。\n\n今晚早点睡吧。明天要是还难受，去找小鹿聊聊，她会懂的。\n\n—— 小局",
    citeKeys: ["insomnia"],
  },
  {
    key: "count:10", sender: "curator", to: "curator", triggerType: "milestone", subject: "第十颗胶囊", writtenDaysAgo: 103, deliverDaysAgo: 103, read: true,
    reason: "你已经在时光邮局放了 10 颗胶囊",
    body: "小满：\n\n你已经放进来十颗胶囊了。我翻了翻：有搬家那天的夕阳，有西湖边的风，有妈妈生日时红了的眼睛，还有第一卷只有 5 张能看的胶卷。\n\n十颗胶囊，拼起来就是你在杭州的第一个季节。继续放吧，我都在。\n\n—— 小局",
    citeKeys: ["move", "bike", "mombday", "firstroll"],
  },
  {
    key: "anniv:erhai:30", sender: "curator", to: "curator", triggerType: "anniversary", subject: "还记得洱海的日出吗", writtenDaysAgo: 61, deliverDaysAgo: 61, read: true,
    reason: "一个月前的今天，你记录了「洱海·粉色的日出」",
    body: "小满，见字如面：\n\n一个月前的清晨五点四十，你在洱海边看到了你见过最好看的日出。阿哲把外套披在你身上，自己冻得一直跺脚。你在心里说：要是能一直这样就好了。\n\n回到杭州一个月了，那天的粉色还留在你心里吗？\n\n—— 小局",
    reply: "留着呢。我打算把那天的照片洗出来做成相册，给阿哲当生日礼物！", citeKeys: ["erhai"],
  },
  {
    key: null, sender: "user", to: "lu", triggerType: "letter", subject: "谢谢你那天拉我去骑车", writtenDaysAgo: 30, deliverDaysAgo: 30, read: true,
    reason: "你写给小鹿的信",
    body: "小鹿：\n\n突然想写封信给你。还记得我刚来杭州那阵子吗？谁也不认识，周末就窝在家里。是你拉我从断桥骑到苏堤，那天我第一次觉得这座城市可以慢下来。\n\n上周你陪我看摄影展，说下一次就是我的展了，我回家想了很久。谢谢你一直在。\n\n—— 满满",
  },
  {
    key: null, sender: "persona", to: "lu", triggerType: "reply", subject: "满满！！", writtenDaysAgo: 29, deliverDaysAgo: 29, read: true,
    inReplyTo: "谢谢你那天拉我去骑车",
    reason: "你在 30 天前给小鹿寄了一封信。这封回信由 agent 以小鹿的身份代笔，只用了小鹿会知道的事。",
    body: "满满：\n\n收到信的时候我在工位上差点哭出来！你知道吗，那天骑车其实是我自己也想偷懒，顺便把你拐出来哈哈。\n\n摄影展那句话我是认真的！你拍年糕的那几张我到现在还存在手机里。下次你要是真的办展，我负责帮你搬画框！\n\n最近忙不忙？有空再一起去骑车吧！\n\n—— 小鹿",
    citeKeys: ["bike", "exhibition"],
  },
  {
    key: null, sender: "user", to: "lu", triggerType: "letter", subject: "最近有点撑不住", writtenDaysAgo: 0, deliverDaysAgo: 0, read: true,
    reason: "你写给小鹿的信",
    body: "小鹿：\n\n这两天有点撑不住。项目上线前一直失眠，昨天在公司被说设计不够细，回家路上没忍住哭了。\n\n不是想让你安慰我，就是想找个人说说。周末有空的话，陪我去西湖边走走吧。\n\n—— 满满",
    replyInHours: 3,
  },
  {
    key: null, sender: "user", to: "future_self", triggerType: "future_letter", subject: "给半年后的自己", writtenDaysAgo: 150, deliverDaysAgo: 0, read: false,
    reason: "这是你在半年前写给未来自己的信",
    body: "半年后的小满：\n\n今天刚买了胶片相机，好开心呀。不知道你现在还有没有在拍照？摄影展的梦想还记得吗？\n\n如果你现在很累，那就停下来，去西湖边走走吧。如果你现在很好，那就替我多拍几张照片。\n\n不管怎样，别忘了你为什么来杭州。\n\n—— 150 天前的你",
  },
];
