from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import inch


OUT = Path(r"D:\桌面\hackathon\MeshCLI-all\MeshCLI\output\pdf\meshcli-technical-architecture.pdf")
W, H = 13.333 * inch, 7.5 * inch

BG = HexColor("#F7F9FD")
WHITE = HexColor("#FFFFFF")
INK = HexColor("#10182C")
MUTED = HexColor("#6E7D96")
BLUE = HexColor("#4D7CFE")
BLUE_DARK = HexColor("#2458D8")
CYAN = HexColor("#57C4F8")
PALE = HexColor("#EAF1FF")
PALE_2 = HexColor("#DCE8FF")
GRID = HexColor("#DDE6F4")
LINE = HexColor("#B9C8DE")
GREEN = HexColor("#38B98A")

pdfmetrics.registerFont(TTFont("Segoe", r"C:\Windows\Fonts\segoeui.ttf"))
pdfmetrics.registerFont(TTFont("SegoeSemi", r"C:\Windows\Fonts\seguisb.ttf"))
pdfmetrics.registerFont(TTFont("SegoeBold", r"C:\Windows\Fonts\segoeuib.ttf"))
pdfmetrics.registerFont(TTFont("Cascadia", r"C:\Windows\Fonts\CascadiaMono.ttf"))


def set_alpha(c, fill=1, stroke=1):
    try:
        c.setFillAlpha(fill)
        c.setStrokeAlpha(stroke)
    except Exception:
        pass


def page_bg(c, index, label):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(GRID)
    set_alpha(c, 0.55, 1)
    for x in range(28, int(W), 24):
        for y in range(24, int(H), 24):
            c.circle(x, y, 0.7, fill=1, stroke=0)
    set_alpha(c, 1, 1)
    c.setStrokeColor(PALE_2)
    c.setLineWidth(0.8)
    c.line(38, H - 35, W - 38, H - 35)
    c.setFont("Cascadia", 7)
    c.setFillColor(BLUE_DARK)
    c.drawString(40, H - 25, f"MESHCLI / {index:02d}")
    c.setFillColor(MUTED)
    c.drawRightString(W - 40, H - 25, label.upper())


def title(c, line1, line2=None, y=H - 92, size=31):
    c.setFont("SegoeBold", size)
    c.setFillColor(INK)
    c.drawString(52, y, line1)
    if line2:
        c.setFillColor(BLUE)
        c.drawString(52, y - size * 1.08, line2)


def tiny_label(c, text, x, y, color=MUTED, align="left"):
    c.setFont("Cascadia", 7.2)
    c.setFillColor(color)
    if align == "center":
        c.drawCentredString(x, y, text.upper())
    elif align == "right":
        c.drawRightString(x, y, text.upper())
    else:
        c.drawString(x, y, text.upper())


def keyword(c, text, x, y, size=18, color=INK, font="SegoeSemi", align="left"):
    c.setFont(font, size)
    c.setFillColor(color)
    if align == "center":
        c.drawCentredString(x, y, text)
    elif align == "right":
        c.drawRightString(x, y, text)
    else:
        c.drawString(x, y, text)


def rounded(c, x, y, w, h, fill=WHITE, stroke=PALE_2, radius=12, sw=1):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(sw)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def connector(c, x1, y1, x2, y2, color=LINE, width=1.4, dashed=False):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.setDash(4, 4) if dashed else c.setDash()
    c.line(x1, y1, x2, y2)
    c.setDash()


def dot(c, x, y, r=5, fill=BLUE, halo=True):
    if halo:
        set_alpha(c, 0.12, 1)
        c.setFillColor(fill)
        c.circle(x, y, r * 2.7, fill=1, stroke=0)
        set_alpha(c, 1, 1)
    c.setFillColor(fill)
    c.circle(x, y, r, fill=1, stroke=0)


def pill(c, text, x, y, w, color=BLUE, fill=PALE):
    c.setFillColor(fill)
    c.setStrokeColor(Color(color.red, color.green, color.blue, alpha=0.32))
    c.roundRect(x, y, w, 24, 12, fill=1, stroke=1)
    c.setFont("Cascadia", 7.4)
    c.setFillColor(color)
    c.drawCentredString(x + w / 2, y + 8, text.upper())


def footer(c, text="CLEAR FOR HUMANS / COMPOSABLE FOR AGENTS"):
    tiny_label(c, text, 52, 25, BLUE_DARK)
    c.setStrokeColor(BLUE)
    c.setLineWidth(2)
    c.line(W - 120, 27, W - 52, 27)


def slide_1(c):
    page_bg(c, 1, "TECH ARCHITECTURE")
    tiny_label(c, "VISUAL AGENT WORKSPACE", 54, H - 78, BLUE_DARK)
    keyword(c, "THINK IN", 54, H - 155, 50, INK, "SegoeBold")
    keyword(c, "MESH.", 54, H - 207, 50, BLUE, "SegoeBold")
    keyword(c, "ACT AS ONE.", 54, H - 278, 31, INK, "SegoeBold")
    keyword(c, "Graph-based reasoning", 56, 170, 16, MUTED)
    keyword(c, "Parallel agents", 56, 141, 16, MUTED)
    keyword(c, "Composable context", 56, 112, 16, MUTED)
    pill(c, "BRANCH", 55, 62, 82)
    pill(c, "EXECUTE", 145, 62, 88)
    pill(c, "MERGE", 241, 62, 76)

    cx, cy = 700, 285
    nodes = [
        (cx, cy, 9, BLUE),
        (cx - 115, cy + 92, 6, CYAN),
        (cx + 112, cy + 105, 6, BLUE),
        (cx + 148, cy - 18, 7, CYAN),
        (cx + 82, cy - 126, 6, BLUE),
        (cx - 88, cy - 116, 7, CYAN),
        (cx - 155, cy - 8, 5, BLUE),
        (cx + 4, cy + 143, 4, BLUE_DARK),
    ]
    for i in range(1, len(nodes)):
        connector(c, cx, cy, nodes[i][0], nodes[i][1], PALE_2, 1.5)
    connector(c, nodes[1][0], nodes[1][1], nodes[7][0], nodes[7][1], PALE_2, 1, True)
    connector(c, nodes[2][0], nodes[2][1], nodes[7][0], nodes[7][1], PALE_2, 1, True)
    connector(c, nodes[4][0], nodes[4][1], nodes[5][0], nodes[5][1], PALE_2, 1, True)
    for x, y, r, color in nodes:
        dot(c, x, y, r, color)
    c.setStrokeColor(BLUE)
    c.setLineWidth(1)
    set_alpha(c, 1, 0.3)
    c.circle(cx, cy, 58, fill=0, stroke=1)
    c.circle(cx, cy, 103, fill=0, stroke=1)
    set_alpha(c, 1, 1)
    tiny_label(c, "ONE INTENT", cx, cy - 3, WHITE, "center")


def slide_2(c):
    page_bg(c, 2, "CORE MODEL")
    title(c, "ONE INTENT.", "MANY PATHS.")
    cx, cy = W / 2, 270
    branches = [
        (210, 350, "EXPLAIN", "Structure / Compare"),
        (750, 350, "EXPLORE", "Branch / Context"),
        (210, 155, "EXECUTE", "Agent / CLI"),
        (750, 155, "MERGE", "Synthesize / Decide"),
    ]
    for x, y, _, _ in branches:
        connector(c, cx, cy, x, y, PALE_2, 2)
    set_alpha(c, 0.12, 1)
    c.setFillColor(BLUE)
    c.circle(cx, cy, 68, fill=1, stroke=0)
    set_alpha(c, 1, 1)
    dot(c, cx, cy, 16, BLUE)
    keyword(c, "INTENT", cx, cy - 4, 14, WHITE, "SegoeBold", "center")
    for i, (x, y, head, sub) in enumerate(branches):
        dot(c, x, y, 7, BLUE if i % 2 == 0 else CYAN)
        keyword(c, head, x, y - 40, 19, INK, "SegoeBold", "center")
        keyword(c, sub, x, y - 65, 11, MUTED, "Segoe", "center")
    keyword(c, "HUMAN CLARITY", 218, 71, 16, BLUE_DARK, "SegoeBold", "center")
    keyword(c, "AGENT COMPOSABILITY", W - 218, 71, 16, BLUE_DARK, "SegoeBold", "center")
    connector(c, 330, 77, W - 330, 77, BLUE, 2)


def slide_3(c):
    page_bg(c, 3, "SYSTEM LAYERS")
    title(c, "A GRAPH WORKSPACE,", "NOT A CHAT WRAPPER.", size=29)
    top_y = 350
    rounded(c, 70, top_y, 820, 64, WHITE, PALE_2, 14)
    keyword(c, "GRAPH UI", 94, top_y + 33, 19, INK, "SegoeBold")
    keyword(c, "React  /  XYFlow  /  Zustand  /  Node-local context", 270, top_y + 34, 14, MUTED)
    connector(c, W / 2, top_y, W / 2, top_y - 35, PALE_2, 2)
    rounded(c, 70, top_y - 99, 820, 64, WHITE, PALE_2, 14)
    keyword(c, "BFF", 94, top_y - 66, 19, INK, "SegoeBold")
    keyword(c, "Hono  /  Secrets  /  Workspace binding  /  SSE", 270, top_y - 65, 14, MUTED)

    split_y = 118
    connector(c, W / 2, top_y - 99, W / 2, top_y - 128, PALE_2, 2)
    connector(c, 285, top_y - 128, 675, top_y - 128, PALE_2, 2)
    connector(c, 285, top_y - 128, 285, split_y + 113, PALE_2, 2)
    connector(c, 675, top_y - 128, 675, split_y + 113, PALE_2, 2)

    rounded(c, 70, split_y, 405, 112, PALE, PALE_2, 16)
    tiny_label(c, "EXPLANATION ROUTE", 94, split_y + 85, BLUE_DARK)
    keyword(c, "Provider adapters", 94, split_y + 54, 18, INK, "SegoeBold")
    keyword(c, "OpenAI-compatible  /  Kimi K3", 94, split_y + 28, 12, MUTED)

    rounded(c, 485, split_y, 405, 112, WHITE, PALE_2, 16)
    tiny_label(c, "AGENT ROUTE", 509, split_y + 85, BLUE_DARK)
    keyword(c, "LangGraph supervisor", 509, split_y + 54, 18, INK, "SegoeBold")
    keyword(c, "Skills  /  MCP  /  OpenHands", 509, split_y + 28, 12, MUTED)

    keyword(c, "SHARED CONTRACTS", 70, 73, 11, BLUE_DARK, "SegoeBold")
    keyword(c, "AgentEvent  /  A2UIBlock  /  CanvasCommand  /  ChangeSet  /  Zod", 235, 73, 12, MUTED)


def slide_4(c):
    page_bg(c, 4, "AGENT EXECUTION")
    title(c, "FROM NODE", "TO EXECUTION.")
    xs = [92, 245, 398, 551, 704, 857]
    labels = [
        ("NODE", "Intent"),
        ("CONTEXT", "Inherited + local"),
        ("SUPERVISOR", "LangGraph"),
        ("TOOLS", "MCP + Skills"),
        ("EXECUTOR", "OpenHands / CLI"),
        ("EVENTS", "SSE stream"),
    ]
    y = 285
    for i in range(len(xs) - 1):
        connector(c, xs[i] + 15, y, xs[i + 1] - 15, y, BLUE, 2)
    for i, (head, sub) in enumerate(labels):
        dot(c, xs[i], y, 8, BLUE if i not in (3, 5) else CYAN)
        keyword(c, head, xs[i], y - 43, 14, INK, "SegoeBold", "center")
        keyword(c, sub, xs[i], y - 67, 9.5, MUTED, "Segoe", "center")

    tiny_label(c, "LIFECYCLE", 72, 155, BLUE_DARK)
    stages = ["PLAN", "EXECUTE", "REVIEW", "APPLY"]
    sx = [250, 410, 570, 730]
    for i, stage in enumerate(stages):
        if i < len(stages) - 1:
            connector(c, sx[i] + 38, 150, sx[i + 1] - 38, 150, LINE, 1.5)
        keyword(c, stage, sx[i], 144, 14, INK, "SegoeBold", "center")
    pill(c, "DIFF", 300, 75, 80)
    pill(c, "APPROVAL", 392, 75, 106)
    pill(c, "APPLY", 510, 75, 82)
    pill(c, "UNDO", 604, 75, 82)
    footer(c, "VISIBLE PROGRESS / EXPLICIT CONTROL")


def slide_5(c):
    page_bg(c, 5, "PROTOCOL LAYER")
    title(c, "VERSIONED CONTRACTS", "KEEP IT COMPOSABLE.", size=29)
    center_x, center_y = W / 2, 268
    connector(c, 250, 337, center_x - 65, center_y + 25, PALE_2, 1.6)
    connector(c, 710, 337, center_x + 65, center_y + 25, PALE_2, 1.6)
    connector(c, 250, 167, center_x - 65, center_y - 25, PALE_2, 1.6)
    connector(c, 710, 167, center_x + 65, center_y - 25, PALE_2, 1.6)
    set_alpha(c, 0.12, 1)
    c.setFillColor(BLUE)
    c.circle(center_x, center_y, 72, fill=1, stroke=0)
    set_alpha(c, 1, 1)
    dot(c, center_x, center_y, 17, BLUE)
    keyword(c, "PROTOCOL", center_x, center_y + 5, 13, WHITE, "SegoeBold", "center")
    tiny_label(c, "BOUNDARY", center_x, center_y - 14, WHITE, "center")

    items = [
        (250, 337, "AgentEvent", "Stream / Replay"),
        (710, 337, "A2UIBlock", "Controlled UI"),
        (250, 167, "CanvasCommand", "Revision / Undo"),
        (710, 167, "ChangeSet", "Diff / Apply"),
    ]
    for i, (x, y, head, sub) in enumerate(items):
        dot(c, x, y, 7, BLUE if i % 2 == 0 else CYAN)
        keyword(c, head, x, y - 35, 17, INK, "SegoeBold", "center")
        keyword(c, sub, x, y - 58, 10.5, MUTED, "Segoe", "center")

    mappings = [
        (130, "MCP", "TOOLS"),
        (330, "SKILLS", "INSTRUCTIONS"),
        (530, "AG-UI", "EVENTS"),
        (730, "A2UI", "PRESENTATION"),
    ]
    for x, head, sub in mappings:
        keyword(c, head, x, 62, 12, BLUE_DARK, "SegoeBold", "center")
        tiny_label(c, sub, x, 43, MUTED, "center")


def slide_6(c):
    page_bg(c, 6, "SAFETY BOUNDARY")
    title(c, "SAFETY IS", "AN ARCHITECTURE LAYER.")
    left, mid, right = 160, 480, 800
    connector(c, left + 45, 285, mid - 55, 285, BLUE, 2)
    connector(c, mid + 55, 285, right - 45, 285, BLUE, 2)
    for x, head, sub, color in [
        (left, "BROWSER", "No secrets / No shell", CYAN),
        (mid, "BFF", "Policy / Workspace", BLUE),
        (right, "RUNTIME", "Isolated execution", BLUE_DARK),
    ]:
        dot(c, x, 285, 11, color)
        keyword(c, head, x, 237, 19, INK, "SegoeBold", "center")
        keyword(c, sub, x, 211, 10.5, MUTED, "Segoe", "center")

    keywords = [
        (100, 130, "WORKSPACE ROOT"),
        (285, 130, "READ-ONLY MCP"),
        (470, 130, "PERMISSION"),
        (655, 130, "REVISION CHECK"),
        (840, 130, "SANDBOXED CLONE"),
        (192, 78, "DIFF"),
        (377, 78, "CANCELLATION"),
        (562, 78, "AUDIT"),
        (747, 78, "UNDO"),
    ]
    for x, y, text in keywords:
        keyword(c, text, x, y, 10.5, BLUE_DARK, "SegoeBold", "center")
        connector(c, x - 32, y - 8, x + 32, y - 8, PALE_2, 2)
    footer(c, "REVIEWABLE / REVERSIBLE / SCOPED")


def slide_7(c):
    page_bg(c, 7, "SYSTEM SUMMARY")
    tiny_label(c, "MESHCLI CORE", 54, H - 82, BLUE_DARK)
    columns = [
        (170, "EXPLAIN", ["Branch", "Structure", "Compare"]),
        (480, "COMPOSE", ["Parallel", "Context", "Merge"]),
        (790, "EXECUTE", ["CLI", "Tools", "Review"]),
    ]
    for i in range(2):
        connector(c, columns[i][0] + 58, 320, columns[i + 1][0] - 58, 320, PALE_2, 2)
    for i, (x, head, words) in enumerate(columns):
        set_alpha(c, 0.11, 1)
        c.setFillColor(BLUE if i != 1 else CYAN)
        c.circle(x, 320, 58, fill=1, stroke=0)
        set_alpha(c, 1, 1)
        dot(c, x, 320, 10, BLUE if i != 1 else CYAN)
        keyword(c, head, x, 220, 23, INK, "SegoeBold", "center")
        for j, word in enumerate(words):
            keyword(c, word, x, 172 - j * 27, 12, MUTED, "Segoe", "center")

    keyword(c, "CLEAR FOR HUMANS.", W / 2, 72, 25, INK, "SegoeBold", "center")
    keyword(c, "COMPOSABLE FOR AGENTS.", W / 2, 41, 25, BLUE, "SegoeBold", "center")


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("MeshCLI Technical Architecture")
    c.setAuthor("MeshCLI")
    for draw in [slide_1, slide_2, slide_3, slide_4, slide_5, slide_6, slide_7]:
        draw(c)
        c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
