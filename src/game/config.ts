/**
 * 游戏平衡常量
 *
 * 集中放这里的目的：数值调优是高频操作，散落在逻辑里会很难改。
 * 所有会影响手感与节奏的数字都必须在此处定义。
 */

// ==================== 棋盘 ====================

export const COLS = 7
export const ROWS = 9
export const TOTAL = COLS * ROWS
/** 前 N 行解锁，其余为锁定区（后续版本用金币逐步解锁） */
export const UNLOCK_ROWS = 5
/** 可用格子数 = 棋盘容量（蛛网会进一步压缩它） */
export const USABLE_CELLS = COLS * UNLOCK_ROWS

// ==================== 体力 ====================

/** 自然恢复上限；领取补贴可突破 */
export const STAMINA_MAX = 100
/** 每 2 分钟恢复 1 点（连续恢复，不是定点回满） */
export const REGEN_MS = 2 * 60 * 1000
/** 每日补贴时段（24 表示当日 24:00，即次日 0 点） */
export const BONUS_HOURS = [12, 18, 24] as const
/** 每次补贴体力 */
export const BONUS_AMOUNT = 50
/** 点击一次恒定消耗 1 点 */
export const CLICK_COST = 1

// ==================== 蛛网障碍 ====================

/** 每 N 次产出生成一张蛛网 */
export const WEB_EVERY = 14
/** 场上蛛网上限（防止棋盘被锁死） */
export const WEB_MAX = 5
/** 第一张蛛网的金币清除价 */
export const WEB_BASE_PRICE = 20
/** 每清除一张，下次涨价 */
export const WEB_STEP = 15

// ==================== 成长 ====================

export const EXP_PER_LEVEL = 100

// ==================== 表现层 ====================

/**
 * 屏幕震动振幅（px）。全项目唯一值，所有合成与升级完全一致，不做分级、不做递增。
 * 改成 0 即全局关闭屏幕震动（粒子与触觉反馈不受影响）。
 *
 * 注意：震的是整个 #app，眼睛会跟整帧走，整屏位移的感知强度远高于同振幅的局部动画，
 * 所以这个值必须压得很低。
 */
export const SHAKE_AMP = 1.0

// ==================== 存档 ====================

export const SAVE_KEY = 'pawpark_save'
/** 存档结构版本。结构变更时递增，旧版存档会被丢弃（除非写了迁移） */
export const SAVE_VERSION = 1
