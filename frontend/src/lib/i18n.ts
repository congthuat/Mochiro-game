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
  'auth.mobileWallet': { en: 'Sign in with a wallet app', vi: 'Đăng nhập bằng ví trên điện thoại' },
  'auth.wallet': { en: 'Connect a wallet', vi: 'Kết nối ví' },
  'auth.noWallet': {
    en: 'No browser wallet found. Install MetaMask, Rabby or OKX to sign in with a wallet.',
    vi: 'Không tìm thấy ví trong trình duyệt. Cài MetaMask, Rabby hoặc OKX để đăng nhập bằng ví.',
  },
  'auth.connecting': { en: 'Waiting for your wallet…', vi: 'Đang chờ ví của bạn…' },
  'auth.signing': { en: 'Check your wallet and sign the message', vi: 'Mở ví và ký thông báo xác nhận' },
  'auth.or': { en: 'or', vi: 'hoặc' },
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
