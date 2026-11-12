// Bilingual UI copy (Vietnamese / English). The player's choice is stored in
// localStorage and detected from the browser on first visit.
import { useCallback, useSyncExternalStore } from 'react'

export type Lang = 'vi' | 'en'

interface Entry {
  en: string
  vi: string
}

const DICT: Record<string, Entry> = {
  // ---------------------------------------------------------------- shell --
  'app.name': { en: 'Mochiro', vi: 'Mochiro' },
  'lang.label': { en: 'Language', vi: 'Ngôn ngữ' },

  // ----------------------------------------------------------------- menu --
  'menu.best': { en: 'Best', vi: 'Kỷ lục' },
  'menu.arcTotal': { en: 'Arc total', vi: 'Tổng Arc' },
  'menu.sprints': { en: 'Sprints', vi: 'Lượt chạy' },
  'menu.farthest': { en: 'Farthest', vi: 'Xa nhất' },
  'menu.chooseRunner': { en: 'Choose your runner', vi: 'Chọn nhân vật của bạn' },
  'menu.tapToPick': { en: 'Click a hero to pick them', vi: 'Bấm vào nhân vật để chọn' },
  'menu.runnerName': { en: 'Runner name', vi: 'Tên người chơi' },
  'menu.start': { en: 'Start sprint', vi: 'Bắt đầu chạy' },
  'menu.howTo': { en: 'How to play', vi: 'Cách chơi' },
  'menu.board': { en: 'Ranking', vi: 'Xếp hạng' },
  'menu.signIn': { en: 'Sign in', vi: 'Đăng nhập' },
  'name.taken': {
    en: 'That name is already taken — pick another',
    vi: 'Tên này đã có người dùng — chọn tên khác',
  },
  'name.short': { en: 'At least 2 characters', vi: 'Cần ít nhất 2 ký tự' },
  'name.blocked': { en: 'That name is not allowed — pick another', vi: 'Tên này không được phép — chọn tên khác' },
  'menu.settings': { en: 'Settings', vi: 'Cài đặt' },
  'menu.connecting': { en: 'Connecting to the global board…', vi: 'Đang kết nối bảng xếp hạng…' },

  // ----------------------------------------------------------------- menu --

  // ----------------------------------------------------------- characters --
  'char.kai.tag': { en: 'Armoured Ace', vi: 'Kỵ sĩ thép' },
  'char.mika.tag': { en: 'Sorceress', vi: 'Pháp sư' },
  'char.bjorn.tag': { en: 'Bruiser', vi: 'Chiến binh' },
  'char.nyx.tag': { en: 'Night blade', vi: 'Sát thủ đêm' },
  'char.rin.tag': { en: 'Marksman', vi: 'Xạ thủ nỏ' },
  'char.tim.tag': { en: 'Duelist', vi: 'Kiếm sĩ' },

  // ------------------------------------------------------------------ hud --
  'hud.combo': { en: 'Combo', vi: 'Chuỗi' },
  'hud.speed': { en: 'Speed', vi: 'Tốc độ' },
  'hud.top': { en: 'Top', vi: 'Đỉnh' },
  'hud.best': { en: 'Best', vi: 'Kỷ lục' },
  'hud.swipeLanes': { en: 'Swipe left / right to switch lanes', vi: 'Vuốt trái / phải để đổi làn' },
  'hud.swipeRest': { en: 'Swipe up to jump · down to slide · tap to jump', vi: 'Vuốt lên để nhảy · xuống để trượt · chạm để nhảy' },
  'char.ability': { en: 'Ability', vi: 'Kỹ năng' },
  'hud.pursuit': { en: 'Danger', vi: 'Nguy hiểm' },
  'mission.distance': { en: 'Distance', vi: 'Quãng đường' },
  'mission.coins': { en: 'Arc coins', vi: 'Coin Arc' },
  'mission.combo': { en: 'Best combo', vi: 'Chuỗi combo' },
  'mission.powers': { en: 'Power-ups', vi: 'Vật phẩm' },
  'mission.slides': { en: 'Slides', vi: 'Lần trượt' },
  'mission.jumps': { en: 'Jumps', vi: 'Lần nhảy' },
  'mission.nearMiss': { en: 'Close calls', vi: 'Suýt soát' },
  'over.missions': { en: 'Missions', vi: 'Nhiệm vụ' },
  'over.nearMiss': { en: 'Close calls', vi: 'Suýt soát' },
  'over.busted': { en: 'Run over — too many crashes', vi: 'Hết lượt — đâm quá nhiều lần' },
  'over.revive': { en: 'Continue', vi: 'Chạy tiếp' },
  'over.reviveCost': { en: 'coins', vi: 'coin' },
  'over.reviveHint': { en: 'Keep this run — the danger bar clears', vi: 'Giữ nguyên lượt này — xoá sạch mức nguy hiểm' },
  'over.noCoins': { en: 'Not enough coins', vi: 'Không đủ coin' },
  'set.difficulty': { en: 'Difficulty', vi: 'Độ khó' },
  'diff.easy': { en: 'Easy', vi: 'Dễ' },
  'diff.normal': { en: 'Normal', vi: 'Thường' },
  'diff.hard': { en: 'Hard', vi: 'Khó' },
  'biome.day': { en: 'Daylight', vi: 'Ban ngày' },
  'biome.golden': { en: 'Golden Hour', vi: 'Giờ vàng' },
  'biome.dusk': { en: 'Dusk', vi: 'Chạng vạng' },
  'biome.neon': { en: 'Neon Night', vi: 'Đêm neon' },
  'perk.shieldStart': { en: 'Starts with a shield up', vi: 'Khởi đầu có sẵn khiên' },
  'perk.longPower': { en: 'Helpful power-ups last +25%', vi: 'Hiệu ứng có lợi kéo dài +25%' },
  'perk.badImmunity': { en: 'Immune to harmful effects', vi: 'Miễn nhiễm hiệu ứng xấu' },
  'power.ward.label': { en: 'WARDED', vi: 'MIỄN NHIỄM' },
  'power.ward.hint': { en: 'Hazard shrugged off', vi: 'Đã chặn hiệu ứng xấu' },
  'perk.quickLane': { en: 'Changes lane 35% faster', vi: 'Chuyển làn nhanh hơn 35%' },
  'perk.wideMagnet': { en: 'Coin magnet reaches 45% further', vi: 'Hút coin xa hơn 45%' },
  'perk.longBoost': { en: 'Overdrive lasts twice as long', vi: 'Tăng tốc kéo dài gấp đôi' },
  'hud.arcCollected': { en: 'Arc collected', vi: 'Arc đã thu' },
  'hud.score': { en: 'Score', vi: 'Điểm' },
  'hud.pause': { en: 'Pause', vi: 'Tạm dừng' },
  'hud.leftLane': { en: 'Left lane', vi: 'Làn trái' },
  'hud.rightLane': { en: 'Right lane', vi: 'Làn phải' },
  'hud.jump': { en: 'Jump', vi: 'Nhảy' },
  'hud.slide': { en: 'Slide', vi: 'Trượt' },

  // ------------------------------------------------------------ power-ups --
  'power.shield.label': { en: 'SHIELD UP', vi: 'KHIÊN BẬT' },
  'power.shield.hint': { en: 'Absorbs one hit', vi: 'Chịu được một đòn' },
  'power.magnet.label': { en: 'MAGNET ONLINE', vi: 'NAM CHÂM BẬT' },
  'power.shield.pill': { en: 'Shield', vi: 'Khiên' },
  'power.magnet.pill': { en: 'Magnet', vi: 'Nam châm' },
  'power.boost.pill': { en: 'Overdrive', vi: 'Tăng tốc' },
  'power.double.pill': { en: 'Double', vi: 'Nhân đôi' },
  'power.ghost.pill': { en: 'Phase', vi: 'Xuyên qua' },
  'power.invert.pill': { en: 'Mirrored', vi: 'Đảo lái' },
  'power.fog.pill': { en: 'Smoke', vi: 'Khói' },
  'power.heavy.pill': { en: 'Heavy', vi: 'Nặng' },
  'power.magnet.hint': { en: 'Every coin comes to you', vi: 'Mọi đồng xu bay về phía bạn' },
  'power.boost.label': { en: 'OVERDRIVE', vi: 'TĂNG TỐC' },
  'power.boost.hint': { en: 'Smash through obstacles', vi: 'Ủi nát chướng ngại' },
  'power.double.label': { en: 'DOUBLE ARC', vi: 'ARC NHÂN ĐÔI' },
  'power.double.hint': { en: 'Every coin pays twice', vi: 'Mỗi đồng xu tính gấp đôi' },
  'power.ghost.label': { en: 'PHASE SHIFT', vi: 'XUYÊN QUA' },
  'power.ghost.hint': { en: 'Traffic passes through you', vi: 'Xe cộ xuyên qua người' },
  'power.invert.label': { en: 'CONTROLS JAMMED', vi: 'LÁI BỊ ĐẢO' },
  'power.invert.hint': { en: 'Left and right are mirrored', vi: 'Trái phải bị đảo ngược' },
  'power.fog.label': { en: 'SMOKE SCREEN', vi: 'MÀN KHÓI' },
  'power.fog.hint': { en: 'The view hazes over', vi: 'Tầm nhìn mờ đi' },
  'power.heavy.label': { en: 'HEAVY LOAD', vi: 'NẶNG NGƯỜI' },
  'power.heavy.hint': { en: 'Your jump is cut short', vi: 'Cú nhảy yếu đi' },


  // ---------------------------------------------------------------- pause --
  'pause.title': { en: 'Paused', vi: 'Đã tạm dừng' },
  'pause.resume': { en: 'Resume', vi: 'Tiếp tục' },
  'pause.restart': { en: 'Restart', vi: 'Chơi lại' },
  'pause.score': { en: 'Score', vi: 'Điểm' },
  'pause.arc': { en: 'Arc collected', vi: 'Arc đã thu' },
  'pause.distance': { en: 'Distance', vi: 'Quãng đường' },

  // ------------------------------------------------------------ game over --
  'over.title': { en: 'Sprint over', vi: 'Kết thúc lượt chạy' },
  'over.record': { en: 'New personal record', vi: 'Kỷ lục cá nhân mới' },
  'over.arc': { en: 'Arc collected', vi: 'Arc đã thu' },
  'over.distance': { en: 'Distance', vi: 'Quãng đường' },
  'over.topSpeed': { en: 'Top km/h', vi: 'Km/h cao nhất' },
  'over.bestCombo': { en: 'Best combo', vi: 'Chuỗi tốt nhất' },
  'over.time': { en: 'Sprint time', vi: 'Thời gian chạy' },
  'over.rank': { en: 'Global rank', vi: 'Xếp hạng toàn cầu' },
  'over.submitting': { en: 'Submitting…', vi: 'Đang gửi…' },
  'over.submitted': { en: 'Submitted — you are on the board', vi: 'Đã gửi — bạn đã có mặt trên bảng' },
  'over.guestSaved': {
    en: 'Saved to your profile. Only signed-in players reach the global board —',
    vi: 'Đã lưu vào hồ sơ của bạn. Chỉ người đã đăng nhập mới lên bảng xếp hạng —',
  },
  'over.guestSignIn': { en: 'sign in', vi: 'đăng nhập ngay' },
  'over.unverified': {
    en: 'Saved to your profile, but this run could not be verified for the global board',
    vi: 'Đã lưu vào hồ sơ, nhưng lượt này chưa xác minh được nên không lên bảng xếp hạng',
  },
  'over.again': { en: 'Sprint again', vi: 'Chạy lại' },
  'over.board': { en: 'Leaderboard', vi: 'Bảng xếp hạng' },
  'over.menu': { en: 'Menu', vi: 'Menu' },

  // ------------------------------------------------------------- settings --
  'set.title': { en: 'Settings', vi: 'Cài đặt' },
  'set.master': { en: 'Master volume', vi: 'Âm lượng tổng' },
  'set.music': { en: 'Music', vi: 'Nhạc nền' },
  'set.effects': { en: 'Effects', vi: 'Hiệu ứng âm' },
  'set.graphics': { en: 'Graphics', vi: 'Đồ hoạ' },
  'set.shake': { en: 'Screen shake', vi: 'Rung màn hình' },
  'set.fps': { en: 'Show FPS', vi: 'Hiện FPS' },
  'set.quality.auto': { en: 'Auto', vi: 'Tự động' },
  'set.quality.adaptive': { en: 'adaptive', vi: 'thích ứng' },
  'set.quality.low': { en: 'Low', vi: 'Thấp' },
  'set.quality.medium': { en: 'Medium', vi: 'Trung bình' },
  'set.quality.high': { en: 'High', vi: 'Cao' },

  // ----------------------------------------------------------------- help --
  'help.title': { en: 'How to play', vi: 'Cách chơi' },
  'help.jump': { en: 'Jump', vi: 'Nhảy' },
  'help.slide': { en: 'Slide', vi: 'Trượt' },
  'help.pause': { en: 'Pause', vi: 'Tạm dừng' },
  'help.pickups': { en: 'Pickups', vi: 'Vật phẩm' },
  'help.boons': { en: 'Blue halo — helpful', vi: 'Hào quang xanh — có lợi' },
  'help.hazards': { en: 'Red spikes — harmful', vi: 'Gai đỏ — có hại' },
  'help.lane': { en: 'Switch lane', vi: 'Đổi làn' },
  'help.jumpBarrier': { en: 'Jump over barriers', vi: 'Nhảy qua rào' },
  'help.slideBar': { en: 'Slide under bars', vi: 'Trượt dưới xà ngang' },
  'help.intro': {
    en: 'Sprint down an endless road through four skies. Grab {brand} coins to build your multiplier, dodge the traffic, and see how far you get. One crash you can run off — two in quick succession end the run.',
    vi: 'Chạy bất tận qua bốn vùng trời. Ăn xu {brand} để tăng hệ số, né xe cộ, và xem bạn đi được bao xa. Một cú đâm thì chạy tiếp được — hai cú liên tiếp là hết lượt.',
  },
  'help.payout': {
    en: '25 a coin × multiplier · +1 multiplier every 8 coins',
    vi: '25 điểm mỗi xu × hệ số · +1 hệ số mỗi 8 xu',
  },
  'help.scoring': { en: 'Scoring', vi: 'Tính điểm' },
  'help.obstacles': { en: 'Obstacles', vi: 'Chướng ngại' },
  'help.obstaclesSub': {
    en: 'Jump the low barriers, slide under the bars, dodge the buses — or land on a car roof and ride it.',
    vi: 'Nhảy qua rào thấp, trượt dưới xà ngang, né xe buýt — hoặc nhảy lên nóc ô tô và chạy trên đó.',
  },

  // ---------------------------------------------------------- leaderboard --
  'board.title': { en: 'Global board', vi: 'Bảng xếp hạng toàn cầu' },
  'board.stats': {
    en: '{runs} sprints · {coins} Arc collected · farthest {far}',
    vi: '{runs} lượt chạy · {coins} Arc đã thu · xa nhất {far}',
  },
  'board.row': {
    en: '{coins} Arc · {dist} · top {speed} km/h',
    vi: '{coins} Arc · {dist} · đỉnh {speed} km/h',
  },
  'board.empty': { en: 'No sprints yet — be the first.', vi: 'Chưa có lượt chạy nào — hãy là người đầu tiên.' },
  'board.close': { en: 'Close', vi: 'Đóng' },

  // ------------------------------------------------------------- economy --
  'eco.bank': { en: 'Wallet', vi: 'Ví' },
  'eco.coins': { en: 'Arc', vi: 'Arc' },
  'menu.shop': { en: 'Shop', vi: 'Cửa hàng' },
  'menu.quests': { en: 'Quests', vi: 'Nhiệm vụ' },
  'menu.unlock': { en: 'Unlock · {price}', vi: 'Mở khoá · {price}' },
  'menu.needMore': { en: 'Need {n} more Arc to unlock', vi: 'Cần thêm {n} Arc để mở khoá' },
  'menu.locked': { en: 'Locked', vi: 'Chưa mở' },
  'shop.up.magnet': { en: 'Magnet', vi: 'Nam châm' },
  'shop.up.boost': { en: 'Overdrive', vi: 'Tăng tốc' },
  'shop.up.double': { en: 'Double Arc', vi: 'Arc nhân đôi' },
  'shop.up.ghost': { en: 'Phase shift', vi: 'Xuyên qua' },
  'shop.title': { en: 'Shop', vi: 'Cửa hàng' },
  'shop.heroes': { en: 'Heroes', vi: 'Nhân vật' },
  'shop.powers': { en: 'Power-ups', vi: 'Vật phẩm' },
  'shop.owned': { en: 'Owned', vi: 'Đã có' },
  'shop.free': { en: 'Free', vi: 'Miễn phí' },
  'shop.buy': { en: 'Buy', vi: 'Mua' },
  'shop.max': { en: 'Max', vi: 'Tối đa' },
  'shop.level': { en: 'Level {n}/{max}', vi: 'Cấp {n}/{max}' },
  'shop.lasts': { en: 'Lasts +{pct}% longer', vi: 'Kéo dài thêm {pct}%' },
  'shop.hint': {
    en: 'Every Arc you collect in a run lands in your wallet. Spend it here.',
    vi: 'Mọi Arc nhặt được trong lượt chạy đều vào ví. Tiêu chúng ở đây.',
  },
  'shop.notEnough': { en: 'Not enough Arc yet — keep running!', vi: 'Chưa đủ Arc — chạy thêm nhé!' },
  'shop.bought': { en: 'Unlocked!', vi: 'Đã mở khoá!' },
  'shop.upgraded': { en: 'Upgraded!', vi: 'Đã nâng cấp!' },
  'shop.failed': { en: 'Could not complete — try again.', vi: 'Chưa thực hiện được — thử lại nhé.' },
  'shop.signInSafe': {
    en: 'Playing as guest: your wallet lives in this browser only. Sign in to keep it everywhere.',
    vi: 'Đang chơi khách: ví chỉ lưu trên trình duyệt này. Đăng nhập để giữ ví trên mọi thiết bị.',
  },
  'daily.title': { en: 'Daily reward', vi: 'Quà mỗi ngày' },
  'daily.day': { en: 'Day {n}', vi: 'Ngày {n}' },
  'daily.claim': { en: 'Claim {n} Arc', vi: 'Nhận {n} Arc' },
  'daily.later': { en: 'Later', vi: 'Để sau' },
  'daily.streak': {
    en: 'Come back every day — day 7 pays the most. Miss a day and the streak restarts.',
    vi: 'Quay lại mỗi ngày — ngày 7 thưởng lớn nhất. Bỏ lỡ một ngày sẽ tính lại từ đầu.',
  },
  'daily.got': { en: '+{n} Arc added to your wallet', vi: '+{n} Arc đã vào ví' },
  'quest.title': { en: 'Daily quests', vi: 'Nhiệm vụ hôm nay' },
  'quest.resets': { en: 'New quests in {time}', vi: 'Nhiệm vụ mới sau {time}' },
  'quest.runs': { en: 'Play {n} runs', vi: 'Chơi {n} lượt' },
  'quest.distance': { en: 'Run {n} m in total', vi: 'Chạy tổng cộng {n} m' },
  'quest.coins': { en: 'Collect {n} Arc in total', vi: 'Nhặt tổng cộng {n} Arc' },
  'quest.score': { en: 'Score {n} in one run', vi: 'Đạt {n} điểm trong một lượt' },
  'quest.combo': { en: 'Reach a {n} combo', vi: 'Đạt combo {n}' },
  'quest.time': { en: 'Run for {n} minutes in total', vi: 'Chạy tổng cộng {n} phút' },
  'quest.claim': { en: 'Claim', vi: 'Nhận' },
  'quest.claimed': { en: 'Done', vi: 'Đã nhận' },
  'quest.note': {
    en: 'Progress counts runs started online today (UTC).',
    vi: 'Tiến độ tính các lượt chạy có mạng trong hôm nay (giờ UTC).',
  },
  'season.title': { en: 'Weekly season', vi: 'Mùa giải tuần' },
  'season.week': { en: 'This week', vi: 'Tuần này' },
  'season.all': { en: 'All time', vi: 'Mọi thời đại' },
  'season.ends': { en: 'Season ends in {time}', vi: 'Mùa giải kết thúc sau {time}' },
  'season.prizes': {
    en: 'Weekly prizes: #1 3,000 · #2 2,000 · #3 1,500 · top 10 600 Arc',
    vi: 'Thưởng tuần: #1 3.000 · #2 2.000 · #3 1.500 · top 10 nhận 600 Arc',
  },
  'season.lastTop': { en: 'Last week’s champions', vi: 'Top 3 tuần trước' },
  'season.reward': { en: 'You finished #{rank} last week!', vi: 'Tuần trước bạn đứng hạng #{rank}!' },
  'season.claim': { en: 'Claim {n} Arc', vi: 'Nhận {n} Arc' },
  'over.banked': { en: '+{n} Arc added to your wallet', vi: '+{n} Arc đã vào ví' },
  'tut.lane': { en: 'Swipe left or right to change lane', vi: 'Vuốt trái / phải để đổi làn' },
  'tut.laneKeys': { en: 'Press A / D (or ← →) to change lane', vi: 'Bấm A / D (hoặc ← →) để đổi làn' },
  'tut.jump': { en: 'Swipe up to jump', vi: 'Vuốt lên để nhảy' },
  'tut.jumpKeys': { en: 'Press SPACE (or ↑) to jump', vi: 'Bấm SPACE (hoặc ↑) để nhảy' },
  'tut.slide': { en: 'Swipe down to slide', vi: 'Vuốt xuống để trượt' },
  'tut.slideKeys': { en: 'Press S (or ↓) to slide', vi: 'Bấm S (hoặc ↓) để trượt' },
  'tut.done': { en: 'Great! Grab Arc, dodge everything', vi: 'Tuyệt! Nhặt Arc, né mọi vật cản' },
  'tut.step': { en: 'Tutorial {n}/3', vi: 'Hướng dẫn {n}/3' },
  'tut.skip': { en: 'Skip', vi: 'Bỏ qua' },

  // ----------------------------------------------------------------- auth --
  'auth.title': { en: 'Sign in to Mochiro', vi: 'Đăng nhập Mochiro' },
  'auth.google': { en: 'Continue with Google', vi: 'Tiếp tục với Google' },
  'auth.inAppTitle': {
    en: 'Google sign-in is blocked inside an app\u2019s browser',
    vi: 'Đăng nhập Google bị chặn trong trình duyệt của app',
  },
  'auth.inAppBody': {
    en: 'Zalo, Facebook and the like open pages in their own browser, and Google refuses to sign in there. Open the game in your phone\u2019s browser instead.',
    vi: 'Zalo, Facebook và các app khác mở trang bằng trình duyệt riêng, và Google từ chối đăng nhập ở đó. Hãy mở game bằng trình duyệt của điện thoại.',
  },
  'auth.openIn': { en: 'Open in', vi: 'Mở bằng' },
  'auth.scanQr': {
    en: 'Open the wallet app on your phone and scan this code.',
    vi: 'Mở ví trên điện thoại và quét mã này.',
  },
  'auth.back': { en: 'Back', vi: 'Quay lại' },
  'pick.more': { en: 'More wallets', vi: 'Ví khác' },
  'pick.install': { en: 'Install', vi: 'Cài đặt' },
  'pick.detected': { en: 'Installed in this browser', vi: 'Đã cài trong trình duyệt' },
  'pick.googleNote': {
    en: 'Get a Mochiro wallet with your Google account. Your keys stay on your device.',
    vi: 'Nhận ví Mochiro bằng tài khoản Google. Chìa khoá ở lại trên máy bạn.',
  },
  'pick.noWalletTitle': { en: 'No wallet found in this browser', vi: 'Chưa thấy ví nào trong trình duyệt này' },
  'pick.tipBrowser': {
    en: 'Each browser has its own extensions. A wallet installed in Chrome is not available in C\u1ed1c C\u1ed1c, Edge or Brave until you install it there too.',
    vi: 'Mỗi trình duyệt có tiện ích riêng. Ví cài trong Chrome sẽ không có trong C\u1ed1c C\u1ed1c, Edge hay Brave cho đến khi bạn cài ví ở trình duyệt đó.',
  },
  'pick.coccoc': {
    en: 'You are using C\u1ed1c C\u1ed1c. It can install wallets from the Chrome Web Store \u2014 install OKX Wallet or MetaMask right here, unlock it, then reload this page.',
    vi: 'Bạn đang dùng C\u1ed1c C\u1ed1c. Trình duyệt này cài được ví từ Chrome Web Store \u2014 hãy cài OKX Wallet hoặc MetaMask ngay tại đây, mở khoá ví, rồi tải lại trang.',
  },
  'pick.rescan': { en: 'Scan again', vi: 'Quét lại' },
  'pick.reload': { en: 'Reload page', vi: 'Tải lại trang' },
  'pick.store': { en: 'Chrome Web Store', vi: 'Chrome Web Store' },
  'pick.wcTitle': { en: 'WalletConnect', vi: 'WalletConnect' },
  'pick.wcHint': { en: 'Scan with a phone wallet', vi: 'Quét bằng ví trên điện thoại' },
  'pick.wcPreparing': { en: 'Preparing the code…', vi: 'Đang tạo mã QR…' },
  'pick.wcErrOrigin': {
    en: 'WalletConnect has not approved this website yet, so the code cannot be created. Use a browser wallet for now.',
    vi: 'WalletConnect chưa cho phép trang web này nên chưa tạo được mã QR. Tạm thời hãy dùng ví cài trên trình duyệt.',
  },
  'pick.wcErrTimeout': {
    en: 'The code took too long to load. Check your connection and try again.',
    vi: 'Tạo mã QR quá lâu. Kiểm tra mạng rồi thử lại nhé.',
  },
  'pick.wcErrExpired': { en: 'The code expired. Pick your wallet again for a new one.', vi: 'Mã QR đã hết hạn. Chọn lại ví để lấy mã mới.' },
  'pick.wcRetry': { en: 'Choose another wallet', vi: 'Chọn ví khác' },
  'pick.scanShort': { en: 'Scan the code', vi: 'Quét mã' },
  'pick.openApp': { en: 'Open the app', vi: 'Mở app' },
  'pick.safety': { en: 'Mochiro never asks for your seed phrase.', vi: 'Mochiro không bao giờ hỏi cụm từ khôi phục.' },
  'pick.helpTitle': { en: 'Could not connect? Try these steps', vi: 'Không kết nối được? Thử các bước sau' },
  'pick.tipUnlock': {
    en: 'Open your wallet extension and unlock it, then try again.',
    vi: 'Mở tiện ích ví và mở khoá, rồi thử lại.',
  },
  'pick.tipPopup': {
    en: 'Look for a wallet popup that may be hidden behind the browser window.',
    vi: 'Tìm cửa sổ ví có thể đang bị che phía sau trình duyệt.',
  },
  'pick.tipConflict': {
    en: 'Several wallets installed at once can fight over the connection. Pick the one you want here.',
    vi: 'Cài nhiều ví cùng lúc có thể tranh nhau kết nối. Hãy chọn đúng ví bạn muốn ở đây.',
  },
  'pick.tipNetwork': {
    en: 'If your wallet asks to add or switch to Arc Testnet, approve it.',
    vi: 'Nếu ví hỏi thêm hoặc chuyển sang mạng Arc Testnet, hãy bấm đồng ý.',
  },
  'auth.wallet': { en: 'Connect a wallet', vi: 'Kết nối ví' },
  'auth.connecting': { en: 'Waiting for your wallet…', vi: 'Đang chờ ví của bạn…' },
  'auth.signing': { en: 'Check your wallet and sign the message', vi: 'Mở ví và ký thông báo xác nhận' },
  'auth.skip': { en: 'Play as guest', vi: 'Chơi không đăng nhập' },
  'auth.createTitle': { en: 'Create your Arc wallet', vi: 'Tạo ví Arc của bạn' },
  'auth.createNote': {
    en: 'Your Google account has no wallet yet. One is generated on this device — the key never leaves it.',
    vi: 'Tài khoản Google của bạn chưa có ví. Ví sẽ được tạo ngay trên máy này — chìa khoá không rời khỏi máy bạn.',
  },
  'auth.password': { en: 'Wallet password', vi: 'Mật khẩu ví' },
  'auth.passwordHint': { en: 'At least 8 characters', vi: 'Ít nhất 8 ký tự' },
  'auth.create': { en: 'Create wallet', vi: 'Tạo ví' },
  'auth.unlock': { en: 'Unlock wallet', vi: 'Mở khoá ví' },
  'auth.unlockNote': { en: 'Welcome back — unlock your wallet.', vi: 'Chào mừng trở lại — mở khoá ví của bạn.' },
  'auth.wrongPassword': { en: 'Wrong wallet password.', vi: 'Sai mật khẩu ví.' },
  'auth.keyTitle': { en: 'Save your recovery key', vi: 'Lưu chìa khoá khôi phục' },
  'auth.keyNote': {
    en: 'This is the only time it is shown. Anyone with this key owns the wallet.',
    vi: 'Đây là lần duy nhất nó hiện ra. Ai có chìa khoá này là có ví.',
  },
  'auth.keySaved': { en: 'I saved my key', vi: 'Tôi đã lưu chìa khoá' },
  'auth.signedIn': { en: 'Signed in', vi: 'Đã đăng nhập' },
  'auth.logout': { en: 'Sign out', vi: 'Đăng xuất' },
  'auth.copy': { en: 'Copy', vi: 'Sao chép' },
  'auth.copied': { en: 'Copied', vi: 'Đã sao chép' },
  'auth.error': { en: 'Sign-in failed. Try again.', vi: 'Đăng nhập thất bại. Thử lại.' },
  'auth.googleUnconfigured': {
    en: 'Google sign-in needs a client id (see README → Accounts).',
    vi: 'Đăng nhập Google cần client id (xem README → Tài khoản).',
  },
}

const listeners = new Set<() => void>()
let current: Lang = detect()

function detect(): Lang {
  try {
    const saved = localStorage.getItem('arcrush.lang')
    if (saved === 'vi' || saved === 'en') return saved
    const nav = typeof navigator !== 'undefined' ? navigator.language?.toLowerCase() ?? '' : ''
    return nav.startsWith('vi') ? 'vi' : 'en'
  } catch {
    return 'en'
  }
}

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  try {
    localStorage.setItem('arcrush.lang', lang)
  } catch {
    /* private mode — the choice just will not persist */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reactive language tag. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang)
}

export function translate(key: string, lang: Lang = current, vars?: Record<string, string | number>): string {
  const entry = DICT[key]
  let text = entry ? entry[lang] : key
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
  }
  return text
}

/** Reactive translator: `const t = useT(); t('menu.start')`. */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useLang()
  return useCallback((key: string, vars?: Record<string, string | number>) => translate(key, lang, vars), [lang])
}

export function formatNumber(value: number, lang: Lang = current): string {
  try {
    return new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US').format(Math.round(value))
  } catch {
    return String(Math.round(value))
  }
}
