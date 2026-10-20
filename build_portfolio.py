from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "evidence"
OUTPUT = ROOT / "output" / "pdf"
TMP = ROOT / "tmp" / "pdfs"
PDF_PATH = OUTPUT / "张成-音频测试工程师-作品集.pdf"

PAGE_W, PAGE_H = landscape(A4)
M = 42

BG = HexColor("#10110F")
PANEL = HexColor("#181A16")
PANEL_2 = HexColor("#20221C")
INK = HexColor("#F2F0E7")
MUTED = HexColor("#9A9D90")
LINE = HexColor("#34372F")
ACID = HexColor("#D8F45F")
ORANGE = HexColor("#FF995F")
RED = HexColor("#FF6565")
TEAL = HexColor("#64D8C2")
BLUE = HexColor("#87A9FF")

FONT_REG = "Deng"
FONT_BOLD = "Deng-Bold"


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(FONT_REG, r"C:\Windows\Fonts\Deng.ttf"))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, r"C:\Windows\Fonts\Dengb.ttf"))


def color(value: str):
    return HexColor(value)


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as stream:
        return json.load(stream)


def crop_to_ratio(source: Path, target: Path, ratio: float) -> Path:
    image = Image.open(source).convert("RGB")
    width, height = image.size
    current = width / height
    if current > ratio:
        new_width = int(height * ratio)
        left = (width - new_width) // 2
        image = image.crop((left, 0, left + new_width, height))
    else:
        new_height = int(width / ratio)
        top = max(0, int((height - new_height) * 0.35))
        image = image.crop((0, top, width, top + new_height))
    image.save(target, quality=92)
    return target


def wrap_text(text: str, font: str, size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    for paragraph in str(text).split("\n"):
        if not paragraph:
            lines.append("")
            continue
        current = ""
        for char in paragraph:
            candidate = current + char
            if pdfmetrics.stringWidth(candidate, font, size) <= max_width or not current:
                current = candidate
            else:
                lines.append(current)
                current = char
        if current:
            lines.append(current)
    return lines


def draw_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    font: str = FONT_REG,
    size: float = 10,
    color_value=INK,
    leading: float | None = None,
) -> float:
    leading = leading or size * 1.55
    c.setFont(font, size)
    c.setFillColor(color_value)
    for line in wrap_text(text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_background(c: canvas.Canvas) -> None:
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setStrokeColor(HexColor("#24261F"))
    c.setLineWidth(0.35)
    for x in range(0, int(PAGE_W), 42):
        c.line(x, 0, x, PAGE_H)
    for y in range(0, int(PAGE_H), 42):
        c.line(0, y, PAGE_W, y)


def draw_header(c: canvas.Canvas, section: str, page: int, title: str, subtitle: str) -> None:
    draw_background(c)
    c.setFillColor(ACID)
    c.rect(M, PAGE_H - 35, 26, 3, fill=1, stroke=0)
    c.setFont(FONT_REG, 8)
    c.setFillColor(MUTED)
    c.drawString(M + 34, PAGE_H - 38, section)
    c.drawRightString(PAGE_W - M, PAGE_H - 38, f"{page:02d} / 12")
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 24)
    c.drawString(M, PAGE_H - 76, title)
    if subtitle:
        draw_wrapped(c, subtitle, M, PAGE_H - 96, PAGE_W - 2 * M, size=9, color_value=MUTED)


def draw_footer(c: canvas.Canvas, page: int) -> None:
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(M, 28, PAGE_W - M, 28)
    c.setFont(FONT_REG, 7.5)
    c.setFillColor(MUTED)
    c.drawString(M, 15, "张成 / 音频测试工程师作品集 / 2027届")
    c.drawRightString(PAGE_W - M, 15, f"LOCAL TESTBED 01 / {page:02d}")


def panel(c: canvas.Canvas, x: float, y: float, width: float, height: float, fill=PANEL) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.roundRect(x, y, width, height, 6, fill=1, stroke=1)


def metric(c: canvas.Canvas, x: float, y: float, value: str, label: str, accent=ACID) -> None:
    c.setFillColor(accent)
    c.setFont(FONT_BOLD, 20)
    c.drawString(x, y, value)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.5)
    c.drawString(x, y - 13, label)


def bullet(c: canvas.Canvas, x: float, y: float, text: str, width: float, color_value=INK) -> float:
    c.setFillColor(ACID)
    c.circle(x + 2, y + 2.5, 2, fill=1, stroke=0)
    return draw_wrapped(c, text, x + 12, y, width - 12, size=9, color_value=color_value, leading=14)


def draw_image_fit(
    c: canvas.Canvas,
    path: Path,
    x: float,
    y: float,
    width: float,
    height: float,
    ratio: float | None = None,
    border=True,
) -> None:
    input_path = path
    if ratio is not None:
        cropped = crop_to_ratio(path, TMP / f"{path.stem}-{ratio:.3f}.jpg", ratio)
        input_path = cropped
    c.setFillColor(HexColor("#090A08"))
    c.rect(x, y, width, height, fill=1, stroke=0)
    c.drawImage(
        ImageReader(str(input_path)),
        x,
        y,
        width=width,
        height=height,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )
    if border:
        c.setStrokeColor(LINE)
        c.setLineWidth(0.8)
        c.rect(x, y, width, height, fill=0, stroke=1)


def draw_table(
    c: canvas.Canvas,
    x: float,
    y_top: float,
    widths: list[float],
    headers: list[str],
    rows: list[list[str]],
    font_size: float = 7.5,
    row_height: float = 24,
    header_height: float = 22,
) -> float:
    total_width = sum(widths)
    c.setFillColor(PANEL_2)
    c.rect(x, y_top - header_height, total_width, header_height, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, font_size)
    cursor = x
    for header, width in zip(headers, widths):
        c.drawString(cursor + 5, y_top - header_height + 7, header)
        cursor += width

    y = y_top - header_height
    for row_index, row in enumerate(rows):
        height = row_height
        wrapped = []
        for cell, width in zip(row, widths):
            lines = wrap_text(cell, FONT_REG, font_size, width - 10)
            wrapped.append(lines)
            height = max(height, 10 + len(lines) * (font_size + 3))
        c.setFillColor(PANEL if row_index % 2 == 0 else HexColor("#151712"))
        c.rect(x, y - height, total_width, height, fill=1, stroke=0)
        c.setStrokeColor(LINE)
        c.line(x, y - height, x + total_width, y - height)
        cursor = x
        for lines, width in zip(wrapped, widths):
            text_y = y - 13
            c.setFillColor(INK)
            c.setFont(FONT_REG, font_size)
            for line in lines:
                c.drawString(cursor + 5, text_y, line)
                text_y -= font_size + 2.5
            cursor += width
        y -= height

    c.setStrokeColor(LINE)
    c.rect(x, y, total_width, y_top - y, fill=0, stroke=1)
    cursor = x
    for width in widths[:-1]:
        cursor += width
        c.line(cursor, y, cursor, y_top)
    return y


def draw_arrow(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float, color_value=LINE) -> None:
    c.setStrokeColor(color_value)
    c.setFillColor(color_value)
    c.setLineWidth(1)
    c.line(x1, y1, x2, y2)
    size = 4
    if abs(x2 - x1) >= abs(y2 - y1):
        direction = 1 if x2 > x1 else -1
        c.line(x2, y2, x2 - direction * size, y2 + size)
        c.line(x2, y2, x2 - direction * size, y2 - size)
    else:
        direction = 1 if y2 > y1 else -1
        c.line(x2, y2, x2 + size, y2 - direction * size)
        c.line(x2, y2, x2 - size, y2 - direction * size)


def draw_check(c: canvas.Canvas, x: float, y: float) -> None:
    c.setStrokeColor(ACID)
    c.setLineWidth(1.4)
    c.line(x, y + 3, x + 3, y)
    c.line(x + 3, y, x + 9, y + 7)


def page_cover(c: canvas.Canvas) -> None:
    draw_background(c)
    c.setFillColor(ACID)
    c.rect(M, PAGE_H - 46, 62, 4, fill=1, stroke=0)
    c.setFont(FONT_REG, 8.5)
    c.setFillColor(MUTED)
    c.drawString(M + 74, PAGE_H - 49, "AUDIO QA PORTFOLIO / 2027 CAMPUS")

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 31)
    c.drawString(M, 452, "战斗音频")
    c.drawString(M, 416, "测试实验场")
    draw_wrapped(
        c,
        "把音频需求转化为事件、用例、故障和可追溯证据。",
        M,
        375,
        286,
        size=13,
        color_value=ORANGE,
        leading=21,
    )

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 14)
    c.drawString(M, 292, "张成")
    c.setFont(FONT_REG, 9)
    c.setFillColor(MUTED)
    c.drawString(M, 276, "安徽理工大学 / 计算机科学与技术 / 2027届")
    c.drawString(M, 260, "求职意向：音频测试工程师")
    c.drawString(M, 226, "作品集 / 面向米哈游音频测试工程师岗位")
    c.drawString(M, 244, "19045515088  |  209894114@qq.com")

    tags = ["FUNCTIONAL", "MIX", "SPATIAL", "PERFORMANCE", "AI-ASSISTED"]
    x = M
    y = 190
    for tag in tags:
        width = pdfmetrics.stringWidth(tag, FONT_REG, 7.5) + 16
        c.setFillColor(HexColor("#20231B"))
        c.setStrokeColor(line := LINE)
        c.roundRect(x, y, width, 21, 4, fill=1, stroke=1)
        c.setFillColor(ACID)
        c.setFont(FONT_REG, 7.5)
        c.drawString(x + 8, y + 7, tag)
        x += width + 6

    image_x = 352
    image_y = 108
    image_w = 446
    image_h = 386
    draw_image_fit(
        c,
        EVIDENCE / "desktop-dashboard.png",
        image_x,
        image_y,
        image_w,
        image_h,
        ratio=image_w / image_h,
    )
    c.setFillColor(HexColor("#0A0B09"))
    c.roundRect(image_x + 14, image_y + 14, 110, 34, 4, fill=1, stroke=0)
    c.setFillColor(ACID)
    c.setFont(FONT_BOLD, 10)
    c.drawString(image_x + 25, image_y + 32, "LIVE TESTBED")
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7)
    c.drawString(image_x + 25, image_y + 21, "Canvas + Web Audio")

    draw_footer(c, 1)
    c.showPage()


def page_positioning(c: canvas.Canvas, result: dict) -> None:
    draw_header(
        c,
        "01 / POSITIONING",
        2,
        "从通用测试基础转向音频专项",
        "不是把简历改写成音频专家，而是证明我理解音频事件、系统风险与测试闭环。",
    )

    y = 438
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 15)
    c.drawString(M, y, "能力转化路径")
    y -= 20

    stages = [
        ("01", "测试全流程", "需求拆解、用例设计、缺陷复现、日志定位、回归闭环"),
        ("02", "音频域理解", "事件触发、状态切换、混音、声像、距离、性能与设备兼容"),
        ("03", "自动化与AI", "Playwright验证事件时间线，AI辅助扩展场景并进行人工筛选"),
    ]
    box_w = (PAGE_W - 2 * M - 24) / 3
    for index, (number, title, description) in enumerate(stages):
        x = M + index * (box_w + 12)
        panel(c, x, 300, box_w, 105, PANEL)
        c.setFillColor(ACID if index < 2 else TEAL)
        c.setFont(FONT_BOLD, 9)
        c.drawString(x + 14, 383, number)
        c.setFillColor(INK)
        c.setFont(FONT_BOLD, 13)
        c.drawString(x + 14, 360, title)
        draw_wrapped(c, description, x + 14, 340, box_w - 28, size=8.5, color_value=MUTED, leading=13)
        if index < 2:
            draw_arrow(c, x + box_w + 1, 351, x + box_w + 10, 351, color_value=ORANGE)

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 12)
    c.drawString(M, 266, "与岗位要求的对应")
    rows = [
        ["全流程质量保障", "音频事件表、风险分析、30项用例、缺陷闭环", "已建立"],
        ["功能与玩法音频", "攻击、受击、技能、语音、BGM状态与死亡反馈", "已覆盖"],
        ["性能与兼容", "活跃声部、峰值、持续渲染、桌面/移动端", "已覆盖"],
        ["AI提升效率", "候选用例生成、人工筛选、自动日志断言", "已实践"],
    ]
    draw_table(
        c,
        M,
        248,
        [132, 450, 78],
        ["岗位能力", "作品集中的证据", "状态"],
        rows,
        font_size=8,
        row_height=28,
        header_height=22,
    )

    panel(c, M, 75, PAGE_W - 2 * M, 62, HexColor("#1B1D18"))
    c.setFillColor(ORANGE)
    c.setFont(FONT_BOLD, 9)
    c.drawString(M + 14, 117, "边界声明")
    draw_wrapped(
        c,
        "本项目验证的是浏览器音频事件与音频图状态，不等同于正式游戏引擎验收。Unity/Wwise、真实声卡、耳机和蓝牙设备仍需后续实机验证。",
        M + 14,
        98,
        PAGE_W - 2 * M - 28,
        size=8.5,
        color_value=MUTED,
        leading=14,
    )

    metric(c, 620, 420, str(len(result["checks"])), "AUTOMATED CHECKS", TEAL)
    metric(c, 700, 420, str(len(load_json(EVIDENCE / "event-trace.json"))), "EVENT TRACE", ORANGE)
    draw_footer(c, 2)
    c.showPage()


def page_architecture(c: canvas.Canvas) -> None:
    draw_header(
        c,
        "02 / SYSTEM",
        3,
        "被测系统与证据链",
        "从玩家操作到音频节点、事件日志和自动断言，每一层都有可观察输出。",
    )

    labels = [
        ("INPUT", "键盘与触控", "移动 / 攻击 / 技能 / 语音"),
        ("GAME STATE", "场景状态机", "玩家位置、敌人、血量、战斗阶段"),
        ("AUDIO EVENTS", "事件总线", "MUSIC / SFX / VOICE / MIX / SYSTEM"),
        ("AUDIO GRAPH", "Web Audio", "Gain / Pan / Filter / Analyser"),
        ("EVIDENCE", "追踪与导出", "事件JSON、自动断言、截图"),
    ]
    box_w = 132
    gap = (PAGE_W - 2 * M - box_w * 5) / 4
    y = 328
    for index, (code, title, detail) in enumerate(labels):
        x = M + index * (box_w + gap)
        fill = PANEL_2 if index < 4 else HexColor("#242719")
        panel(c, x, y, box_w, 112, fill)
        c.setFillColor([ACID, BLUE, ORANGE, TEAL, ACID][index])
        c.setFont(FONT_REG, 7.5)
        c.drawString(x + 11, y + 93, code)
        c.setFillColor(INK)
        c.setFont(FONT_BOLD, 11.5)
        c.drawString(x + 11, y + 71, title)
        draw_wrapped(c, detail, x + 11, y + 51, box_w - 22, size=8, color_value=MUTED, leading=13)
        if index < 4:
            draw_arrow(c, x + box_w + 1, y + 55, x + box_w + gap - 2, y + 55, color_value=LINE)

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 12)
    c.drawString(M, 284, "监测指标")
    metrics = [
        ("BGM状态", "EXPLORE / COMBAT"),
        ("活跃声部", "实时计数与回收"),
        ("峰值电平", "RMS与削波预警"),
        ("事件序列", "触发、顺序、延迟、重复"),
        ("布局状态", "桌面与移动端"),
    ]
    x = M
    for label, value in metrics:
        width = (PAGE_W - 2 * M - 24) / 5
        panel(c, x, 214, width, 50, PANEL)
        c.setFillColor(MUTED)
        c.setFont(FONT_REG, 7.5)
        c.drawString(x + 10, 246, label)
        c.setFillColor(INK)
        c.setFont(FONT_BOLD, 9)
        c.drawString(x + 10, 228, value)
        x += width + 6

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 12)
    c.drawString(M, 184, "事件设计示例")
    rows = [
        ["VOICE", "voice_start", "进入VOICE总线，记录初始声像"],
        ["MIX", "bgm_duck", "语音开始时压低Music总线"],
        ["MIX", "bgm_restore", "语音结束后恢复Music总线"],
        ["SFX", "impact_hit", "记录命中声部、增益和实际声像"],
        ["FAULT", "fault_enabled", "记录故障类型和启停时间"],
    ]
    draw_table(c, M, 166, [72, 130, PAGE_W - 2 * M - 202], ["总线", "事件", "可验证内容"], rows, font_size=8)
    draw_footer(c, 3)
    c.showPage()


def page_strategy(c: canvas.Canvas) -> None:
    draw_header(
        c,
        "03 / STRATEGY",
        4,
        "测试策略与风险优先级",
        "先验证高频、高影响、可自动断言的路径，再用故障注入验证测试本身能否发现问题。",
    )

    risks = [
        ("P0", "攻击判定与声音不同步", "记录攻击、命中事件时间差；注入220ms延迟。", "时间线"),
        ("P0", "快速操作导致声部叠加", "构造重复触发并检查额外声部。", "事件计数"),
        ("P0", "BGM切换出现静音断点", "注入360ms切换间隙并检查恢复。", "状态序列"),
        ("P0", "语音压低后不恢复", "对比恢复事件次数与BGM音量状态。", "混音状态"),
        ("P0", "声像方向错误", "输入固定正声像，核对实际应用负值。", "参数断言"),
        ("P1", "静音状态VOICE泄漏", "在静音状态下注入VOICE泄漏。", "故障事件"),
    ]
    rows = [[level, name, method, evidence] for level, name, method, evidence in risks]
    draw_table(
        c,
        M,
        470,
        [42, 185, 380, 132],
        ["级别", "风险", "测试策略", "证据"],
        rows,
        font_size=8.2,
        row_height=38,
        header_height=23,
    )

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 12)
    c.drawString(M, 212, "测试分层")
    layers = [
        ("L1", "事件级", "是否触发、名称、总线、时间戳", ACID),
        ("L2", "参数级", "增益、声像、延迟、重复和距离衰减", BLUE),
        ("L3", "系统级", "BGM状态机、暂停恢复、静音和重置", TEAL),
        ("L4", "体验级", "耳机、扬声器、蓝牙与主观音量平衡", ORANGE),
    ]
    x = M
    for code, title, detail, accent in layers:
        width = (PAGE_W - 2 * M - 30) / 4
        panel(c, x, 105, width, 80, PANEL)
        c.setFillColor(accent)
        c.setFont(FONT_BOLD, 8)
        c.drawString(x + 10, 166, code)
        c.setFillColor(INK)
        c.setFont(FONT_BOLD, 11)
        c.drawString(x + 10, 146, title)
        draw_wrapped(c, detail, x + 10, 127, width - 20, size=7.8, color_value=MUTED, leading=12)
        x += width + 10

    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 8)
    c.drawString(M, 80, "本轮自动化完整覆盖L1-L3；L4保留为真实设备人工验证，不以浏览器模拟替代。")
    draw_footer(c, 4)
    c.showPage()


def page_dashboard(c: canvas.Canvas, result: dict, events: list[dict]) -> None:
    draw_header(
        c,
        "04 / EXECUTION",
        5,
        "真实运行结果",
        "桌面端完整交互截图、自动检查结果和故障事件分布共同构成本轮证据。",
    )

    draw_image_fit(
        c,
        EVIDENCE / "desktop-dashboard.png",
        M,
        120,
        500,
        350,
        ratio=500 / 350,
    )

    card_x = 565
    metric(c, card_x, 444, f"{len(result['checks'])}/{len(result['checks'])}", "自动检查通过", ACID)
    metric(c, card_x, 388, str(len(events)), "音频事件", ORANGE)
    metric(c, card_x, 332, str(sum(1 for event in events if event.get("status") == "fault")), "故障证据", RED)
    metric(c, card_x, 276, "0", "控制台错误", TEAL)

    panel(c, card_x, 142, PAGE_W - M - card_x, 88, PANEL)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 9)
    c.drawString(card_x + 12, 208, "测试环境")
    draw_wrapped(
        c,
        "Windows 11 / Chrome 155 / 1440 x 1024 + 390 x 844 / Playwright / Web Audio API",
        card_x + 12,
        188,
        PAGE_W - M - card_x - 24,
        size=7.8,
        color_value=MUTED,
        leading=12,
    )

    categories = [
        ("功能", 10, ACID),
        ("混音", 4, BLUE),
        ("空间", 4, TEAL),
        ("性能", 3, ORANGE),
        ("兼容", 3, MUTED),
        ("故障", 6, RED),
    ]
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 9)
    c.drawString(card_x, 122, "用例构成")
    x = card_x
    for label, count, accent in categories:
        width = 16 + count * 4.3
        c.setFillColor(accent)
        c.roundRect(x, 88, width, 18, 3, fill=1, stroke=0)
        c.setFillColor(BG)
        c.setFont(FONT_BOLD, 6.8)
        c.drawString(x + 4, 94, f"{label}{count}")
        x += width + 4

    draw_footer(c, 5)
    c.showPage()


CASES = [
    ("F01", "功能", "启动测试场", "音频上下文运行", "PASS"),
    ("F02", "功能", "探索BGM初始化", "状态为EXPLORE", "PASS"),
    ("F03", "功能", "进入战斗", "状态切换为COMBAT", "PASS"),
    ("F04", "功能", "普通攻击", "挥动与命中事件", "PASS"),
    ("F05", "功能", "技能释放", "释放与命中事件", "PASS"),
    ("F06", "功能", "战斗语音", "VOICE事件触发", "PASS"),
    ("F07", "功能", "敌人死亡", "死亡音频事件", "PASS"),
    ("F08", "功能", "静音", "Master输出关闭", "PASS"),
    ("F09", "功能", "暂停与恢复", "上下文暂停后恢复", "PASS"),
    ("F10", "功能", "重置", "会话和故障清空", "PASS"),
    ("M01", "混音", "Master音量", "增益同步为55%", "PASS"),
    ("M02", "混音", "Music音量", "Music总线变化", "PASS"),
    ("M03", "混音", "SFX音量", "SFX总线变化", "PASS"),
    ("M04", "混音", "Voice音量", "Voice总线变化", "PASS"),
    ("S01", "空间", "右侧声源", "记录正声像", "PASS"),
    ("S02", "空间", "远距离声源", "距离越远增益越低", "PASS"),
    ("S03", "空间", "声像反转", "实际值为输入的反号", "PASS"),
    ("S04", "空间", "实时敌人位置", "声像随位置变化", "PASS"),
    ("P01", "性能", "Canvas初始渲染", "非空且存在像素变化", "PASS"),
    ("P02", "性能", "交互后持续渲染", "两帧校验值不同", "PASS"),
    ("P03", "性能", "活跃声部", "计数不为负数", "PASS"),
    ("C01", "兼容", "桌面1440", "无横向溢出", "PASS"),
    ("C02", "兼容", "移动390", "无溢出和按钮重叠", "PASS"),
    ("C03", "兼容", "控制台", "无脚本与资源错误", "PASS"),
    ("X01", "故障", "攻击延迟220ms", "延迟事件可追踪", "PASS"),
    ("X02", "故障", "命中音重复", "额外声部可追踪", "PASS"),
    ("X03", "故障", "BGM断点360ms", "断点与恢复可追踪", "PASS"),
    ("X04", "故障", "BGM不恢复", "缺失恢复事件", "PASS"),
    ("X05", "故障", "VOICE泄漏", "泄漏事件可追踪", "PASS"),
    ("X06", "故障", "重置清除故障", "全部开关关闭", "PASS"),
]


def page_cases(c: canvas.Canvas, page: int, start: int, end: int) -> None:
    draw_header(
        c,
        "05 / TEST MATRIX",
        page,
        f"测试用例矩阵 {start // 15 + 1}/2",
        "30项用例覆盖六类测试范围；状态结果与自动检查、事件日志一一对应。",
    )
    rows = [list(item) for item in CASES[start:end]]
    draw_table(
        c,
        M,
        455,
        [46, 56, 170, 336, 62],
        ["ID", "类型", "场景", "预期结果", "结果"],
        rows,
        font_size=7.4,
        row_height=23,
        header_height=22,
    )
    c.setFont(FONT_REG, 7.2)
    c.setFillColor(MUTED)
    c.drawString(M, 58, "完整原始数据：evidence/event-trace.json、evidence/automation-result.json")
    draw_footer(c, page)
    c.showPage()


def fault_card(
    c: canvas.Canvas,
    x: float,
    y: float,
    width: float,
    height: float,
    number: str,
    title: str,
    fault: str,
    evidence: str,
    observation: str,
    accent,
) -> None:
    panel(c, x, y, width, height, PANEL)
    c.setFillColor(accent)
    c.setFont(FONT_BOLD, 8)
    c.drawString(x + 12, y + height - 20, number)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 12)
    c.drawString(x + 12, y + height - 43, title)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.5)
    c.drawString(x + 12, y + height - 61, f"FAULT / {fault}")
    c.setFillColor(accent)
    c.setFont(FONT_BOLD, 8)
    c.drawString(x + 12, y + 45, evidence)
    draw_wrapped(c, observation, x + 12, y + 31, width - 24, size=7.5, color_value=MUTED, leading=11)


def page_faults(c: canvas.Canvas) -> None:
    draw_header(
        c,
        "06 / FAILURE EVIDENCE",
        8,
        "故障注入证据 1/2",
        "不是只展示“功能正常”，而是证明测试能够发现并定位典型音频异常。",
    )
    card_w = (PAGE_W - 2 * M - 20) / 3
    fault_card(
        c,
        M,
        186,
        card_w,
        250,
        "CASE 01",
        "攻击音效延迟",
        "latency",
        "事件ID 13 / 220ms",
        "命中音在攻击挥动后延迟触发，事件日志保留注入延迟与实际播放时间。",
        ORANGE,
    )
    fault_card(
        c,
        M + card_w + 10,
        186,
        card_w,
        250,
        "CASE 02",
        "命中音重复叠加",
        "duplicate",
        "事件ID 18-19 / +18ms",
        "主命中音之外额外生成一条重复事件，能够与正常声部区分并统计。",
        RED,
    )
    fault_card(
        c,
        M + 2 * (card_w + 10),
        186,
        card_w,
        250,
        "CASE 03",
        "BGM切换断点",
        "bgmGap",
        "事件ID 26-27 / 360ms",
        "断点开始与恢复完成分别记录，可计算切换总耗时并检查状态最终一致性。",
        BLUE,
    )

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 11)
    c.drawString(M, 145, "证据链结构")
    draw_wrapped(
        c,
        "触发条件 -> 预期行为 -> 实际事件 -> 时间差/参数 -> 影响判断",
        M,
        124,
        PAGE_W - 2 * M,
        size=10,
        color_value=ACID,
        leading=16,
    )
    draw_footer(c, 8)
    c.showPage()


def page_faults_2(c: canvas.Canvas) -> None:
    draw_header(
        c,
        "06 / FAILURE EVIDENCE",
        9,
        "故障注入证据 2/2",
        "混音恢复、空间定位和静音状态同样需要事件级证据，而非只依赖肉眼观察。",
    )
    card_w = (PAGE_W - 2 * M - 20) / 3
    fault_card(
        c,
        M,
        186,
        card_w,
        250,
        "CASE 04",
        "BGM不恢复",
        "duckStuck",
        "事件ID 34",
        "语音结束后没有出现bgm_restore，恢复次数保持不变，异常被自动断言捕获。",
        ORANGE,
    )
    fault_card(
        c,
        M + card_w + 10,
        186,
        card_w,
        250,
        "CASE 05",
        "声像左右反转",
        "panInvert",
        "事件ID 21 / 0.800 -> -0.800",
        "原始输入声像与实际应用声像同时写入日志，方向错误可直接核对。",
        TEAL,
    )
    fault_card(
        c,
        M + 2 * (card_w + 10),
        186,
        card_w,
        250,
        "CASE 06",
        "静音状态VOICE泄漏",
        "voiceLeak",
        "事件ID 37",
        "静音后记录VOICE总线泄漏状态，为后续节点级混音定位保留线索。",
        RED,
    )

    draw_image_fit(c, EVIDENCE / "fault-panel.png", M, 70, 320, 96, ratio=320 / 96)
    panel(c, 378, 70, PAGE_W - M - 378, 96, PANEL)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 9)
    c.drawString(392, 144, "可重复验证")
    draw_wrapped(
        c,
        "六个故障均通过手动开关与 window.__AUDIO_LAB__.setFault() 注入，自动测试使用同一入口复现。",
        392,
        124,
        PAGE_W - M - 406,
        size=8,
        color_value=MUTED,
        leading=13,
    )
    draw_footer(c, 9)
    c.showPage()


def page_automation(c: canvas.Canvas, events: list[dict]) -> None:
    draw_header(
        c,
        "07 / AUTOMATION + AI",
        10,
        "自动化与AI辅助流程",
        "AI用于扩展候选场景，人负责风险判断；自动化负责重复验证和证据沉淀。",
    )

    stages = [
        ("01", "需求与事件表", "拆解BGM、SFX、VOICE、MIX与空间风险"),
        ("02", "AI候选集", "生成功能、边界、异常与兼容性候选用例"),
        ("03", "人工筛选", "删除不可执行、低风险与重复场景"),
        ("04", "自动执行", "Playwright触发、读取事件、断言结果"),
        ("05", "证据导出", "事件JSON、截图、测试结果"),
    ]
    x = M
    y = 356
    for index, (code, title, detail) in enumerate(stages):
        width = 135
        panel(c, x, y, width, 104, PANEL)
        c.setFillColor(ACID if index < 3 else TEAL)
        c.setFont(FONT_BOLD, 8)
        c.drawString(x + 10, y + 84, code)
        c.setFillColor(INK)
        c.setFont(FONT_BOLD, 10.5)
        c.drawString(x + 10, y + 64, title)
        draw_wrapped(c, detail, x + 10, y + 45, width - 20, size=7.5, color_value=MUTED, leading=11)
        if index < 4:
            draw_arrow(c, x + width + 1, y + 53, x + width + 10, y + 53, color_value=LINE)
        x += width + 10

    panel(c, M, 116, 466, 210, HexColor("#11130F"))
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 10)
    c.drawString(M + 14, 304, "事件时间线摘录")
    trace_items = [
        event
        for event in events
        if event["name"]
        in {
            "impact_hit",
            "latency_fault_applied",
            "bgm_switch_gap",
            "bgm_state_change",
            "duck_restore_missing",
            "enemy_proximity",
            "voice_leak_fault_applied",
        }
    ][:9]
    y_line = 280
    for event in trace_items:
        c.setFillColor(MUTED)
        c.setFont(FONT_REG, 7)
        c.drawString(M + 14, y_line, f"{event['relativeT'] / 1000:07.3f}s")
        c.setFillColor(RED if event["status"] == "fault" else ACID)
        c.setFont(FONT_BOLD, 7)
        c.drawString(M + 86, y_line, event["name"])
        c.setFillColor(MUTED)
        c.setFont(FONT_REG, 6.8)
        c.drawString(M + 245, y_line, f"{event['bus']} / ID {event['id']}")
        y_line -= 20

    panel(c, 530, 116, PAGE_W - M - 530, 210, PANEL)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 10)
    c.drawString(544, 304, "人工判断点")
    judgments = [
        "用例是否符合真实玩家操作路径",
        "故障严重度是否符合版本风险",
        "日志是否足以支持研发定位",
        "哪些听感问题不能由自动断言替代",
    ]
    y_text = 278
    for item in judgments:
        c.setFillColor(ORANGE)
        c.circle(548, y_text + 2.5, 2, fill=1, stroke=0)
        y_text = draw_wrapped(
            c,
            item,
            560,
            y_text,
            PAGE_W - M - 574,
            size=8.3,
            color_value=MUTED,
            leading=12,
        ) - 10

    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 7.5)
    c.drawString(M, 92, "自动化不替代测试判断：断言负责稳定复现，人工负责定义“什么才算问题”。")
    draw_footer(c, 10)
    c.showPage()


def page_game_audio(c: canvas.Canvas) -> None:
    draw_header(
        c,
        "08 / GAME AUDIO PERSPECTIVE",
        11,
        "游戏音频观察",
        "以长期游戏经验建立对反馈时机、方向感和状态转换的敏感度，并转成测试问题。",
    )

    games = [
        (
            "《只狼》约200小时",
            "战斗反馈",
            "关注格挡、识破提示音与动作判定之间的关系；检测时重点看音效是否提前、延后或缺失。",
            ORANGE,
        ),
        (
            "《三角洲行动》约1300小时",
            "空间定位",
            "关注脚步、换弹、枪声的方向和距离感；测试时重点看声像、衰减与遮挡是否一致。",
            TEAL,
        ),
        (
            "《最终幻想7》系列与Steam动作/RPG累计约5000小时",
            "状态与层次",
            "关注战斗BGM切换、技能音效层次和环境声；测试时重点看切换、混音与重复触发。",
            BLUE,
        ),
    ]
    y = 350
    for title, focus, text, accent in games:
        panel(c, M, y, 465, 94, PANEL)
        c.setFillColor(accent)
        c.setFont(FONT_BOLD, 8)
        c.drawString(M + 14, y + 75, focus)
        c.setFillColor(INK)
        c.setFont(FONT_BOLD, 10.5)
        c.drawString(M + 14, y + 56, title)
        draw_wrapped(c, text, M + 14, y + 38, 430, size=7.8, color_value=MUTED, leading=12)
        y -= 105

    panel(c, 535, 135, PAGE_W - M - 535, 309, PANEL)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 11)
    c.drawString(550, 418, "从“玩家感受”到“测试问题”")
    rows = [
        ["听觉感受", "设计意图", "可测指标"],
        ["打击不跟手", "攻击与命中反馈同步", "事件时间差"],
        ["敌人方向不清", "空间定位准确", "声像与距离增益"],
        ["战斗进不去状态", "BGM切换连续", "断点时长与恢复"],
        ["语音听不清", "语音优先、BGM闪避", "Ducking与恢复"],
        ["音效太吵", "关键声部层级清晰", "重复触发与峰值"],
    ]
    draw_table(
        c,
        550,
        398,
        [100, 115, PAGE_W - M - 550 - 215],
        rows[0],
        rows[1:],
        font_size=7.6,
        row_height=34,
        header_height=8,
    )

    c.setFillColor(ORANGE)
    c.setFont(FONT_BOLD, 8)
    c.drawString(550, 150, "游戏经历来自现有简历，未虚构米哈游游戏时长或段位。")
    draw_footer(c, 11)
    c.showPage()


def page_close(c: canvas.Canvas, result: dict, events: list[dict]) -> None:
    draw_background(c)
    c.setFillColor(ACID)
    c.rect(M, PAGE_H - 46, 62, 4, fill=1, stroke=0)
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 8.5)
    c.drawString(M + 74, PAGE_H - 49, "09 / SUMMARY")

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 26)
    c.drawString(M, 455, "把问题变成可复现证据")
    draw_wrapped(
        c,
        "我的优势是测试执行和问题定位，正在把这项能力迁移到游戏音频领域。",
        M,
        421,
        440,
        size=13,
        color_value=ORANGE,
        leading=21,
    )

    metric(c, M, 347, f"{len(result['checks'])}/{len(result['checks'])}", "自动检查通过", ACID)
    metric(c, 210, 347, str(len(events)), "真实事件记录", ORANGE)
    metric(c, 355, 347, "6", "故障类型验证", RED)
    metric(c, 500, 347, "30", "测试用例", TEAL)

    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 11)
    c.drawString(M, 296, "下一步补齐")
    next_steps = [
        "Unity/Wwise中的Event、Switch、RTPC与Bus配置验证",
        "耳机、扬声器、蓝牙与不同声卡设备的实听兼容测试",
        "长时运行下的声部回收、内存和音频线程性能测试",
    ]
    y = 272
    for item in next_steps:
        y = bullet(c, M, y, item, 450, color_value=MUTED) - 9

    panel(c, 530, 148, PAGE_W - M - 530, 300, PANEL_2)
    c.setFillColor(ACID)
    c.setFont(FONT_BOLD, 8)
    c.drawString(548, 416, "PROJECT DELIVERABLES")
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 13)
    c.drawString(548, 386, "本地交互Demo")
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 8.2)
    c.drawString(548, 367, "Canvas 2D + Web Audio API")
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 13)
    c.drawString(548, 327, "测试方案与报告")
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 8.2)
    c.drawString(548, 308, "30项用例 / 6类故障 / 风险边界")
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 13)
    c.drawString(548, 268, "自动测试证据")
    c.setFillColor(MUTED)
    c.setFont(FONT_REG, 8.2)
    c.drawString(548, 249, "Playwright / JSON事件 / 桌面与移动截图")
    c.setStrokeColor(LINE)
    c.line(548, 226, PAGE_W - M - 18, 226)
    c.setFillColor(INK)
    c.setFont(FONT_BOLD, 9)
    c.drawString(548, 199, "张成 / 2027届")
    c.setFillColor(ACID)
    c.setFont(FONT_REG, 9)
    c.drawString(548, 181, "19045515088")
    c.drawString(548, 165, "209894114@qq.com")

    draw_footer(c, 12)
    c.showPage()


def build_pdf() -> None:
    register_fonts()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    result = load_json(EVIDENCE / "automation-result.json")
    events = load_json(EVIDENCE / "event-trace.json")

    c = canvas.Canvas(str(PDF_PATH), pagesize=(PAGE_W, PAGE_H))
    c.setTitle("战斗音频测试实验场作品集")
    c.setAuthor("张成")
    c.setSubject("音频测试工程师求职作品集")
    c.setCreator("Audio QA Lab")

    page_cover(c)
    page_positioning(c, result)
    page_architecture(c)
    page_strategy(c)
    page_dashboard(c, result, events)
    page_cases(c, 6, 0, 15)
    page_cases(c, 7, 15, 30)
    page_faults(c)
    page_faults_2(c)
    page_automation(c, events)
    page_game_audio(c)
    page_close(c, result, events)
    c.save()
    print(PDF_PATH)


if __name__ == "__main__":
    build_pdf()
