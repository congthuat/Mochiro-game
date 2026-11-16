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

  // ------------------------------------------- shell: boot, errors, fatal --
  'boot.failTitle': { en: 'Mochiro could not load', vi: 'Chưa tải được Mochiro' },
  'boot.failBody': {
    en: 'The connection dropped while the game was loading. Check your network and try again.',
    vi: 'Kết nối bị gián đoạn trong lúc tải game. Kiểm tra mạng rồi thử lại nhé.',
  },
  'boot.retrying': { en: 'Trying again…', vi: 'Đang thử tải lại…' },
  'boot.reload': { en: 'Reload', vi: 'Tải lại' },
  'error.title': { en: 'Something went wrong', vi: 'Đã có lỗi xảy ra' },
  'error.body': {
    en: 'The game hit an unexpected snag. Reloading usually fixes it — your progress is safe.',
    vi: 'Game gặp một lỗi không mong muốn. Tải lại trang thường sẽ khắc phục được — tiến độ của bạn vẫn an toàn.',
  },
  'error.panelTitle': { en: 'This panel could not open', vi: 'Không mở được mục này' },
  'error.panelBody': {
    en: 'Close it and carry on playing, or reload the page if it keeps happening.',
    vi: 'Hãy đóng lại và chơi tiếp, hoặc tải lại trang nếu lỗi vẫn lặp lại.',
  },
  'error.reload': { en: 'Reload', vi: 'Tải lại' },
  'fatal.title': { en: 'Cannot start the game', vi: 'Không khởi động được game' },
  'fatal.webgl': {
    en: 'This browser could not start 3D graphics (WebGL). Try an up-to-date Chrome, Edge, Firefox or Safari.',
    vi: 'Trình duyệt này không chạy được đồ hoạ 3D (WebGL). Hãy thử Chrome, Edge, Firefox hoặc Safari bản mới nhất.',
  },
  'fatal.load': {
    en: 'The game files did not finish downloading. Check your connection and reload.',
    vi: 'Chưa tải xong dữ liệu game. Kiểm tra kết nối mạng rồi tải lại trang nhé.',
  },
  'load.boot': { en: 'Starting the runner', vi: 'Đang khởi động' },
  'load.network': { en: 'Contacting the Arc network', vi: 'Đang kết nối mạng Arc' },
  'load.coins': { en: 'Minting coin art', vi: 'Đang đúc đồng xu' },
  'load.skyline': { en: 'Building the skyline', vi: 'Đang dựng thành phố' },
  'load.runner': { en: 'Suiting up the runner', vi: 'Đang chuẩn bị nhân vật' },
  'load.engines': { en: 'Warming the engines', vi: 'Sắp xong rồi' },
  'time.dh': { en: '{d}d {h}h', vi: '{d} ngày {h} giờ' },
  'time.hm': { en: '{h}h {m}m', vi: '{h} giờ {m} phút' },
  'time.m': { en: '{m}m', vi: '{m} phút' },
  'hud.multPop': { en: 'Multiplier ×{n}', vi: 'Hệ số ×{n}' },
  'help.keySwipe': { en: 'SWIPE', vi: 'VUỐT' },
  'help.keyTap': { en: 'TAP', vi: 'CHẠM' },
  'toasts.label': { en: 'Notifications', vi: 'Thông báo' },

  // ------------------------------------------------------- run submission --
  'over.submitFailed': {
    en: 'Could not reach the board. Your run is saved on this device and will be sent automatically.',
    vi: 'Chưa gửi được lên bảng xếp hạng. Lượt chạy đã được lưu trên máy và sẽ tự gửi lại.',
  },
  'over.submitRetry': { en: 'Send now', vi: 'Gửi lại ngay' },
  'over.slowDown': {
    en: 'The server is busy — your run will be sent again in a moment.',
    vi: 'Máy chủ đang bận — lượt chạy sẽ được gửi lại sau giây lát.',
  },
  'over.signedOut': {
    en: 'Your sign-in expired. Sign in again and this run will be sent.',
    vi: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để gửi lượt chạy này.',
  },
  'over.rejected': {
    en: 'The server could not accept this run, so it was not added to the board.',
    vi: 'Máy chủ không chấp nhận lượt chạy này nên nó không được đưa lên bảng xếp hạng.',
  },
  'over.duplicate': { en: 'This run was already sent.', vi: 'Lượt chạy này đã được gửi trước đó.' },
  'over.review': {
    en: 'Your score is being checked before it goes on the board.',
    vi: 'Điểm đang được kiểm tra trước khi lên bảng xếp hạng.',
  },
  'over.sentLater': { en: 'Your saved run reached the board', vi: 'Lượt chạy đã lưu đã được gửi lên bảng xếp hạng' },

  // ------------------------------------------------------ sign-in errors --
  'auth.err.rejected': { en: 'You cancelled the request.', vi: 'Bạn đã huỷ yêu cầu.' },
  'auth.err.noWallet': {
    en: 'No wallet was found in this browser.',
    vi: 'Không tìm thấy ví nào trong trình duyệt này.',
  },
  'auth.err.noAccount': {
    en: 'The wallet did not share an address. Unlock it and try again.',
    vi: 'Ví chưa chia sẻ địa chỉ. Hãy mở khoá ví rồi thử lại.',
  },
  'auth.err.verify': {
    en: 'The signature could not be verified. Please try again.',
    vi: 'Không xác minh được chữ ký. Vui lòng thử lại.',
  },
  'auth.err.wcConfig': {
    en: 'WalletConnect is not available right now. Use a browser wallet or Google instead.',
    vi: 'WalletConnect hiện chưa dùng được. Hãy dùng ví trên trình duyệt hoặc Google.',
  },
  'auth.err.network': {
    en: 'Cannot reach the server. Check your connection and try again.',
    vi: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại nhé.',
  },
  'auth.err.server': {
    en: 'The server is having trouble right now. Please try again in a moment.',
    vi: 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau ít phút.',
  },
  'auth.err.expired': {
    en: 'The sign-in request expired. Please try again.',
    vi: 'Yêu cầu đăng nhập đã hết hạn. Vui lòng thử lại.',
  },
  'auth.err.domain': {
    en: 'This sign-in request was made for a different website. Reload the page and try again.',
    vi: 'Yêu cầu đăng nhập này không dành cho trang web này. Tải lại trang rồi thử lại nhé.',
  },
  'auth.err.chain': {
    en: 'Switch your wallet to the Arc Testnet network, then try again.',
    vi: 'Hãy chuyển ví sang mạng Arc Testnet rồi thử lại.',
  },
  'auth.err.google': {
    en: 'Google sign-in did not go through. Please try again.',
    vi: 'Đăng nhập Google chưa thành công. Vui lòng thử lại.',
  },
  'auth.err.slowDown': {
    en: 'Too many attempts. Wait a moment, then try again.',
    vi: 'Bạn thử quá nhiều lần. Đợi một lát rồi thử lại nhé.',
  },
  'auth.err.storage': {
    en: 'This browser is blocking storage (private mode?), so a wallet cannot be kept here.',
    vi: 'Trình duyệt đang chặn lưu dữ liệu (có thể do chế độ ẩn danh) nên không thể lưu ví trên máy này.',
  },
  'auth.err.walletOwned': {
    en: 'The wallet on this device already belongs to another account. Use a new wallet on this device, or sign in with that account.',
    vi: 'Ví trên máy này đã thuộc về một tài khoản khác. Hãy dùng ví mới trên máy này, hoặc đăng nhập bằng tài khoản đó.',
  },
  'auth.linkFailed': {
    en: 'The wallet could not be linked to your Google account. Please try again.',
    vi: 'Chưa liên kết được ví với tài khoản Google. Vui lòng thử lại.',
  },
  'auth.checkingGoogle': { en: 'Signing in with Google…', vi: 'Đang đăng nhập bằng Google…' },
  'auth.unlocking': { en: 'Unlocking your wallet…', vi: 'Đang mở khoá ví…' },
  'auth.forgot': {
    en: 'Forgot password / use a new wallet on this device',
    vi: 'Quên mật khẩu / dùng ví mới trên máy này',
  },
  'auth.forgotTitle': { en: 'Use a new wallet on this device?', vi: 'Dùng ví mới trên máy này?' },
  'auth.forgotBody': {
    en: 'The old wallet ({address}) will be removed from this device and a new one created for this Google account. An account that already signs in with Google keeps its scores and Arc. Anything held on-chain in the old wallet can only be recovered with its recovery key.',
    vi: 'Ví cũ ({address}) sẽ bị xoá khỏi máy này và một ví mới được tạo cho tài khoản Google này. Tài khoản đã đăng nhập bằng Google vẫn giữ nguyên điểm và Arc. Tài sản trên chuỗi trong ví cũ (nếu có) chỉ lấy lại được bằng chìa khoá khôi phục.',
  },
  'auth.forgotConfirm': { en: 'Remove it and create a new wallet', vi: 'Xoá và tạo ví mới' },
  'auth.cancel': { en: 'Cancel', vi: 'Huỷ' },

  // ----------------------------------------------------------------- menu --
  'menu.best': { en: 'Best', vi: 'Kỷ lục' },
  'menu.arcTotal': { en: 'Arc collected', vi: 'Arc đã nhặt' },
  'menu.sprints': { en: 'Sprints', vi: 'Lượt chạy' },
  'menu.farthest': { en: 'Farthest', vi: 'Xa nhất' },
  'menu.chooseRunner': { en: 'Choose your runner', vi: 'Chọn nhân vật của bạn' },
  'menu.tapToPick': { en: 'Click a hero to pick them', vi: 'Bấm vào nhân vật để chọn' },
  'menu.runnerName': { en: 'Runner name', vi: 'Tên người chơi' },
  'menu.start': { en: 'Start sprint', vi: 'Bắt đầu chạy' },
  'menu.howTo': { en: 'Help', vi: 'Cách chơi' },
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

  // ------------------------------------------------------------------ hud --
  'hud.combo': { en: 'Combo', vi: 'Chuỗi' },
  'hud.speed': { en: 'Speed', vi: 'Tốc độ' },
  'hud.top': { en: 'Top', vi: 'Đỉnh' },
  'hud.best': { en: 'Best', vi: 'Kỷ lục' },
  'runner.tier.warmup': { en: 'Warm-up', vi: 'Khởi động' },
  'runner.tier.overclock': { en: 'Overclock', vi: 'Tăng tốc' },
  'runner.tier.surge': { en: 'Surge', vi: 'Bứt phá' },
  'runner.tier.hyperdrive': { en: 'Hyperdrive', vi: 'Siêu tốc' },
  'runner.tier.terminal': { en: 'Terminal Velocity', vi: 'Tốc độ tối đa' },
  'runner.toast.go': { en: 'GO!', vi: 'CHẠY!' },
  'runner.toast.quality': { en: 'Graphics quality lowered to keep the pace', vi: 'Đã giảm đồ hoạ để game chạy mượt' },
  'runner.toast.tier': { en: '{tier} — {speed} km/h', vi: '{tier} — {speed} km/h' },
  'runner.toast.perfectLine': { en: 'Perfect line +{n}', vi: 'Gom trọn hàng +{n}' },
  'runner.toast.ward': { en: 'WARD — hazard shrugged off', vi: 'KHIÊN BẢO HỘ — bỏ qua bẫy' },
  'runner.toast.shield': { en: 'Shield up — one free hit', vi: 'Có khiên — đỡ được 1 cú va' },
  'runner.toast.magnet': { en: 'Magnet online — {s}s', vi: 'Nam châm — {s}s' },
  'runner.toast.double': { en: 'Double Arc — {s}s', vi: 'Nhân đôi Arc — {s}s' },
  'runner.toast.ghost': { en: 'Phase shift — {s}s', vi: 'Xuyên vật cản — {s}s' },
  'runner.toast.invert': { en: 'Controls jammed — {s}s', vi: 'Đảo điều khiển — {s}s' },
  'runner.toast.fog': { en: 'Smoke screen — {s}s', vi: 'Màn khói — {s}s' },
  'runner.toast.heavy': { en: 'Heavy load — jumps fall short', vi: 'Nặng người — nhảy thấp hơn' },
  'runner.toast.boost': { en: 'OVERDRIVE — smash through!', vi: 'SIÊU TỐC — húc xuyên mọi thứ!' },
  'runner.toast.absorbed': { en: 'Shield absorbed the hit', vi: 'Khiên đã đỡ cú va' },
  'runner.toast.close': { en: 'CLOSE!', vi: 'SUÝT NỮA!' },
  'runner.toast.close2': { en: 'CLOSE ×2!', vi: 'SUÝT NỮA ×2!' },
  'runner.toast.mission': { en: 'MISSION!', vi: 'XONG NHIỆM VỤ!' },
  'hud.swipeLanes': { en: 'Swipe left / right to switch lanes', vi: 'Vuốt trái / phải để đổi làn' },
  'hud.swipeRest': { en: 'Swipe up to jump · down to slide · tap to jump', vi: 'Vuốt lên để nhảy · xuống để trượt · chạm để nhảy' },
  'char.ability': { en: 'Ability', vi: 'Kỹ năng' },
  'char.inUse': { en: 'In use', vi: 'Đang dùng' },
  'char.buy': { en: 'Buy {n}', vi: 'Mua {n}' },
  'hud.pursuit': { en: 'Danger', vi: 'Nguy hiểm' },
  'mission.distance': { en: 'Distance', vi: 'Quãng đường' },
  'mission.coins': { en: 'Arc coins', vi: 'Xu Arc' },
  'mission.combo': { en: 'Best combo', vi: 'Chuỗi combo' },
  'mission.powers': { en: 'Power-ups', vi: 'Vật phẩm' },
  'mission.slides': { en: 'Slides', vi: 'Lần trượt' },
  'mission.jumps': { en: 'Jumps', vi: 'Lần nhảy' },
  'mission.nearMiss': { en: 'Close calls', vi: 'Suýt soát' },
  'over.missions': { en: 'Missions', vi: 'Nhiệm vụ' },
  'over.nearMiss': { en: 'Close calls', vi: 'Suýt soát' },
  'over.busted': { en: 'Run over — too many crashes', vi: 'Hết lượt — đâm quá nhiều lần' },
  'over.revive': { en: 'Continue', vi: 'Chạy tiếp' },
  'over.reviveCost': { en: 'Arc', vi: 'Arc' },
  'over.reviveHint': {
    en: 'Costs a quarter of this run’s Arc — keep the run, the danger bar clears',
    vi: 'Tốn 1/4 số Arc của lượt này — giữ nguyên lượt, xoá sạch thanh nguy hiểm',
  },
  'over.noCoins': { en: 'Not enough Arc', vi: 'Không đủ Arc' },
  'set.difficulty': { en: 'Difficulty', vi: 'Độ khó' },
  'diff.easy': { en: 'Easy', vi: 'Dễ' },
  'diff.normal': { en: 'Normal', vi: 'Thường' },
  'diff.hard': { en: 'Hard', vi: 'Khó' },
  'diff.easy.desc': {
    en: 'Slower, roomier, half the bad pick-ups. Score ×0.5 · Arc ×0.7 — for learning.',
    vi: 'Chậm hơn, nhiều khoảng trống, ít vật phẩm xấu. Điểm ×0.5 · Arc ×0.7 — để tập chơi.',
  },
  'diff.normal.desc': {
    en: 'The standard run. Score ×1 · Arc ×1.',
    vi: 'Chế độ chuẩn. Điểm ×1 · Arc ×1.',
  },
  'diff.hard.desc': {
    en: 'Faster, tighter, more hazards. Score ×1.5 · Arc ×1.3 — where the board is won.',
    vi: 'Nhanh hơn, dày vật cản, nhiều vật phẩm xấu. Điểm ×1.5 · Arc ×1.3 — nơi tranh top.',
  },
  'over.modeMult': { en: 'points ×{score}', vi: 'điểm ×{score}' },
  'biome.day': { en: 'Daylight', vi: 'Ban ngày' },
  'biome.golden': { en: 'Golden Hour', vi: 'Giờ vàng' },
  'biome.dusk': { en: 'Dusk', vi: 'Chạng vạng' },
  'biome.neon': { en: 'Neon Night', vi: 'Đêm neon' },
  'perk.shieldStart': { en: 'Starts with a shield up', vi: 'Khởi đầu có sẵn khiên' },
  'perk.longPower': { en: 'Helpful power-ups last +20%', vi: 'Hiệu ứng có lợi kéo dài +20%' },
  'perk.badImmunity': { en: 'Immune to harmful effects', vi: 'Miễn nhiễm hiệu ứng xấu' },
  'power.ward.label': { en: 'WARDED', vi: 'MIỄN NHIỄM' },
  'power.ward.hint': { en: 'Hazard shrugged off', vi: 'Đã chặn hiệu ứng xấu' },
  'perk.quickLane': { en: 'Close calls ×2, lanes 35% faster', vi: 'Né sát ×2 điểm, đổi làn nhanh 35%' },
  'perk.wideMagnet': { en: 'Pulls close coins, magnet +45% reach', vi: 'Tự hút xu ở gần, nam châm hút xa hơn 45%' },
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
  'over.topSpeed': { en: 'Top km/h', vi: 'Tốc độ cao nhất' },
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
  'shop.up.magnet': { en: 'Magnet', vi: 'Nam châm' },
  'shop.up.boost': { en: 'Overdrive', vi: 'Tăng tốc' },
  'shop.up.double': { en: 'Double Arc', vi: 'Arc nhân đôi' },
  'shop.up.ghost': { en: 'Phase shift', vi: 'Xuyên qua' },
  'shop.title': { en: 'Shop', vi: 'Cửa hàng' },
  'shop.heroes': { en: 'Heroes', vi: 'Nhân vật' },
  'shop.powers': { en: 'Power-ups', vi: 'Vật phẩm' },
  'shop.owned': { en: 'Owned', vi: 'Đã có' },
  'shop.free': { en: 'Free', vi: 'Miễn phí' },
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
  'today.title': { en: 'Today', vi: 'Hôm nay' },
  'today.daily': { en: 'Day {d} gift', vi: 'Quà ngày {d}' },
  'today.dailyDone': { en: 'Gift collected — back tomorrow', vi: 'Đã nhận quà — mai quay lại nhé' },
  'today.collect': { en: 'Claim {n}', vi: 'Nhận {n}' },
  'daily.day': { en: 'Day {n}', vi: 'Ngày {n}' },
  'daily.claim': { en: 'Claim {n} Arc', vi: 'Nhận {n} Arc' },
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
  'season.week': { en: 'This week', vi: 'Tuần này' },
  'season.all': { en: 'All time', vi: 'Mọi thời đại' },
  'season.ends': { en: 'Season ends in {time}', vi: 'Mùa giải kết thúc sau {time}' },
  'season.prizes': {
    en: 'Weekly prizes: #1 10,000 · #2 6,000 · #3 4,000 · top 10 2,000 Arc',
    vi: 'Thưởng tuần: #1 10.000 · #2 6.000 · #3 4.000 · top 10 nhận 2.000 Arc',
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
  'auth.createTitle': { en: 'Create your Arc wallet', vi: 'Tạo ví Arc của bạn' },
  'auth.createNote': {
    en: 'Your Google account has no wallet yet. One is generated on this device — the key never leaves it.',
    vi: 'Tài khoản Google của bạn chưa có ví. Ví sẽ được tạo ngay trên máy này — chìa khoá không rời khỏi máy bạn.',
  },
  'auth.password': { en: 'Wallet password', vi: 'Mật khẩu ví' },
  // ---------------------------------------------------------- achievements --
  'menu.achievements': { en: 'Badges', vi: 'Thành tựu' },
  'menu.invite': { en: 'Invite', vi: 'Mời bạn' },
  'ach.title': { en: 'Achievements', vi: 'Thành tựu' },
  'ach.progress': { en: '{n}/{max} tiers reached', vi: 'Đã đạt {n}/{max} cấp' },
  'ach.tier': { en: 'Tier {n} of {max}', vi: 'Cấp {n}/{max}' },
  'ach.claimAll': { en: 'Claim all · +{n} Arc', vi: 'Nhận tất cả · +{n} Arc' },
  'ach.maxed': { en: 'Every tier reached', vi: 'Đã đạt mọi cấp' },
  'ach.done': { en: 'Done', vi: 'Hoàn tất' },
  'ach.lifeCoins': { en: 'Arc collected', vi: 'Arc đã nhặt' },
  'ach.note': {
    en: 'Only runs the server stamped count. Rewards go straight to your wallet.',
    vi: 'Chỉ các lượt chạy được máy chủ ghi nhận mới được tính. Thưởng vào thẳng ví của bạn.',
  },
  'ach.guest': {
    en: 'Playing as a guest: progress stays on this device. Sign in to keep it everywhere.',
    vi: 'Bạn đang chơi khách: tiến độ chỉ lưu trên máy này. Đăng nhập để giữ ở mọi nơi.',
  },
  'ach.distance': { en: 'Long haul', vi: 'Chạy xa' },
  'ach.distance.goal': { en: 'Run {n} in one sprint', vi: 'Chạy {n} trong một lượt' },
  'ach.score': { en: 'High scorer', vi: 'Cao thủ' },
  'ach.score.goal': { en: 'Score {n} in one sprint', vi: 'Đạt {n} điểm trong một lượt' },
  'ach.combo': { en: 'Combo master', vi: 'Bậc thầy combo' },
  'ach.combo.goal': { en: 'Reach a ×{n} combo', vi: 'Đạt chuỗi combo ×{n}' },
  'ach.runs': { en: 'Never stop', vi: 'Bền bỉ' },
  'ach.runs.goal': { en: 'Finish {n} sprints', vi: 'Hoàn thành {n} lượt chạy' },
  'ach.coins': { en: 'Arc hunter', vi: 'Thợ săn Arc' },
  'ach.coins.goal': { en: 'Collect {n} Arc in total', vi: 'Nhặt tổng cộng {n} Arc' },
  'ach.hard': { en: 'Fearless', vi: 'Gan dạ' },
  'ach.hard.goal': { en: 'Run {n} on Hard', vi: 'Chạy {n} ở chế độ Khó' },
  'ach.upgrades': { en: 'Engineer', vi: 'Kỹ sư' },
  'ach.upgrades.goal': { en: 'Max out {n} power-up(s)', vi: 'Nâng tối đa {n} vật phẩm' },
  'ach.streak': { en: 'Regular', vi: 'Chuyên cần' },
  'ach.streak.goal': { en: 'Claim the daily reward {n} times', vi: 'Nhận quà đăng nhập {n} lần' },
  'ach.quests': { en: 'Quest hunter', vi: 'Thợ nhiệm vụ' },
  'ach.quests.goal': { en: 'Complete {n} daily quests', vi: 'Hoàn thành {n} nhiệm vụ ngày' },
  'ach.friends': { en: 'Crew', vi: 'Kết nối' },
  'ach.friends.goal': { en: 'Bring {n} friend(s) into the game', vi: 'Mời {n} bạn vào chơi' },

  // ---------------------------------------------------------------- invite --
  'invite.title': { en: 'Invite friends', vi: 'Mời bạn bè' },
  'invite.step1': { en: 'Send your link to a friend', vi: 'Gửi link của bạn cho bạn bè' },
  'invite.step2': {
    en: 'They sign in for the first time and run {m} in one sprint',
    vi: 'Bạn ấy đăng nhập lần đầu và chạy được {m} trong một lượt',
  },
  'invite.step3': { en: 'You get {you} Arc, they get {them} Arc', vi: 'Bạn nhận {you} Arc, bạn ấy nhận {them} Arc' },
  'invite.share': { en: 'Share link', vi: 'Chia sẻ link' },
  'invite.copy': { en: 'Copy link', vi: 'Sao chép link' },
  'invite.joined': { en: 'Joined', vi: 'Đã tham gia' },
  'invite.paid': { en: 'Rewarded', vi: 'Đã thưởng' },
  'invite.earned': { en: 'Arc earned', vi: 'Arc đã nhận' },
  'invite.signIn': {
    en: 'Sign in to get your own invite link.',
    vi: 'Đăng nhập để có link mời của riêng bạn.',
  },
  'invite.note': {
    en: 'Up to {cap} friends. Only new accounts can join through a link.',
    vi: 'Tối đa {cap} bạn. Link mời chỉ áp dụng cho tài khoản mới tạo.',
  },
  'invite.from': { en: 'Invited by {name}', vi: 'Bạn được {name} mời' },
  'invite.welcomeNeed': {
    en: 'Run {m} in one sprint to unlock your {n} Arc welcome gift',
    vi: 'Chạy {m} trong một lượt để mở quà chào mừng {n} Arc',
  },
  'invite.pending': {
    en: 'Sign in with a new account to lock in your {n} Arc welcome gift',
    vi: 'Đăng nhập bằng tài khoản mới để giữ quà chào mừng {n} Arc',
  },
  'invite.welcomeReady': { en: 'Your {n} Arc welcome gift is ready', vi: 'Quà chào mừng {n} Arc đã sẵn sàng' },
  'invite.welcomePaid': { en: 'Welcome gift collected: {n} Arc', vi: 'Đã nhận quà chào mừng {n} Arc' },
  'invite.banner': {
    en: '{name} invited you — sign in and get {n} Arc',
    vi: '{name} mời bạn chơi — đăng nhập để nhận {n} Arc',
  },
  'invite.joinedToast': { en: 'Invite from {name} accepted', vi: 'Đã nhận lời mời của {name}' },
  'invite.shareText': {
    en: 'Come run with me in Mochiro! Sign in with my link and get {n} Arc:',
    vi: 'Vào chạy Mochiro cùng mình nhé! Đăng nhập qua link này để nhận {n} Arc:',
  },

  // ----------------------------------------------------------------- share --
  'over.share': { en: 'Share', vi: 'Khoe điểm' },
  'share.tagline': { en: 'Endless runner', vi: 'Game chạy vô tận' },
  'share.scored': { en: '{name} scored', vi: '{name} đã đạt' },
  'share.beat': { en: 'Can you beat it?', vi: 'Bạn có vượt qua được không?' },
  'share.text': { en: 'I scored {score} in Mochiro. Can you beat it?', vi: 'Mình vừa đạt {score} điểm trong Mochiro. Bạn vượt qua được không?' },
  'share.title': { en: 'Show off your run', vi: 'Khoe điểm' },
  'share.making': { en: 'Making your card…', vi: 'Đang tạo ảnh…' },
  'share.error': { en: 'Could not make the picture — you can still copy the link.', vi: 'Không tạo được ảnh — bạn vẫn có thể sao chép link.' },
  'share.hold': { en: 'Tip: press and hold the picture to save it.', vi: 'Mẹo: nhấn giữ vào ảnh để lưu về máy.' },
  'share.send': { en: 'Share picture', vi: 'Chia sẻ ảnh' },
  'share.sendLink': { en: 'Share link', vi: 'Chia sẻ link' },
  'share.save': { en: 'Save picture', vi: 'Lưu ảnh' },
  'share.copyLink': { en: 'Copy link', vi: 'Sao chép link' },
  'share.saved': { en: 'Picture saved', vi: 'Đã lưu ảnh' },
  'share.failed': { en: 'Could not share on this browser', vi: 'Trình duyệt này không chia sẻ được' },

  // ------------------------------------------------------------------- pwa --
  'pwa.install': { en: 'Install Mochiro on this device', vi: 'Cài Mochiro ra màn hình chính' },
  'pwa.title': { en: 'Add to Home Screen', vi: 'Thêm vào màn hình chính' },
  'pwa.ios1': { en: 'Tap the Share button in Safari', vi: 'Bấm nút Chia sẻ của Safari' },
  'pwa.ios2': { en: 'Choose “Add to Home Screen”', vi: 'Chọn “Thêm vào MH chính”' },
  'pwa.ios3': { en: 'Open Mochiro from its new icon', vi: 'Mở Mochiro từ biểu tượng mới' },
  'pwa.why': {
    en: 'It opens full screen, like an app, and loads faster next time.',
    vi: 'Game mở toàn màn hình như một ứng dụng và vào nhanh hơn ở lần sau.',
  },
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
// The page starts as <html lang="en">; screen readers and the browser's own translate
// offer need the real language from the first paint, not only after a manual switch.
if (typeof document !== 'undefined') document.documentElement.lang = current

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

const numberFormats: Partial<Record<Lang, Intl.NumberFormat>> = {}
export function formatNumber(value: number, lang: Lang = current): string {
  try {
    const format = (numberFormats[lang] ??= new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US'))
    return format.format(Math.round(value))
  } catch {
    return String(Math.round(value))
  }
}
