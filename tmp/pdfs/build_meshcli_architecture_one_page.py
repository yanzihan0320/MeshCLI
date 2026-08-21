from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color


W, H = 960, 540
BASE = Path(__file__).resolve().parents[2]
OUT = BASE / "output" / "pdf" / "meshcli-technical-architecture-one-page.pdf"

BG = HexColor("#F7FAFF")
INK = HexColor("#101828")
MUTED = HexColor("#667892")
BLUE = HexColor("#4B7CFF")
BLUE_DARK = HexColor("#1F56D8")
CYAN = HexColor("#50B9E9")
PALE = HexColor("#EAF1FF")
LINE = HexColor("#CAD9F6")
WHITE = HexColor("#FFFFFF")


def register_fonts():
    candidates = [
        ("Segoe", r"C:\Windows\Fonts\segoeui.ttf"),
        ("SegoeBold", r"C:\Windows\Fonts\segoeuib.ttf"),
        ("Cascadia", r"C:\Windows\Fonts\CascadiaMono.ttf"),
    ]
    for name, path in candidates:
        if Path(path).exists():
            pdfmetrics.registerFont(TTFont(name, path))


def set_alpha(c, fill=1, stroke=1):
    try:
        c.setFillAlpha(fill)
        c.setStrokeAlpha(stroke)
    except Exception:
        pass


def text(c, value, x, y, size, color=INK, font="Segoe", align="left"):
    c.setFont(font, size)
    c.setFillColor(color)
    if align == "center":
        c.drawCentredString(x, y, value)
    elif align == "right":
        c.drawRightString(x, y, value)
    else:
        c.drawString(x, y, value)


def background(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(HexColor("#DCE8FA"))
    set_alpha(c, 0.45, 1)
    for x in range(24, W, 24):
        for y in range(20, H, 24):
            c.circle(x, y, 0.65, fill=1, stroke=0)
    set_alpha(c, 1, 1)
    c.setFillColor(WHITE)
    set_alpha(c, 0.72, 1)
    c.circle(480, 288, 190, fill=1, stroke=0)
    set_alpha(c, 1, 1)


def connector(c, x1, y1, x2, y2, bend=0):
    c.setStrokeColor(LINE)
    c.setLineWidth(1.7)
    c.bezier(x1, y1, x1 + bend, y1, x2 - bend, y2, x2, y2)


def section(c, x, y, width, title, items, accent=BLUE):
    c.setFillColor(accent)
    c.roundRect(x, y + 112, 7, 32, 3.5, fill=1, stroke=0)
    text(c, title, x + 19, y + 118, 22, INK, "SegoeBold")
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    c.line(x, y + 102, x + width, y + 102)

    col_w = width / 2
    for index, item in enumerate(items):
        col = index % 2
        row = index // 2
        item_x = x + col * col_w
        item_y = y + 76 - row * 25
        c.setFillColor(accent if row == 0 else BLUE_DARK)
        set_alpha(c, 0.88 if row == 0 else 0.65, 1)
        c.circle(item_x + 5, item_y + 4, 3.2, fill=1, stroke=0)
        set_alpha(c, 1, 1)
        text(c, item, item_x + 16, item_y, 11.2, MUTED, "Segoe")


def core(c):
    cx, cy = 480, 288
    set_alpha(c, 0.10, 1)
    c.setFillColor(BLUE)
    c.circle(cx, cy, 104, fill=1, stroke=0)
    set_alpha(c, 1, 0.28)
    c.setStrokeColor(BLUE)
    c.setLineWidth(1.4)
    c.circle(cx, cy, 86, fill=0, stroke=1)
    c.circle(cx, cy, 70, fill=0, stroke=1)
    set_alpha(c, 1, 1)
    c.setFillColor(WHITE)
    c.circle(cx, cy, 58, fill=1, stroke=0)
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    c.circle(cx, cy, 58, fill=0, stroke=1)
    c.setFillColor(BLUE)
    c.circle(cx, cy + 21, 6, fill=1, stroke=0)
    text(c, "MESHCLI", cx, cy - 4, 22, INK, "SegoeBold", "center")
    text(c, "CORE", cx, cy - 25, 9, BLUE_DARK, "Cascadia", "center")


def foundation(c):
    x, y, w, h = 54, 30, 852, 56
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, 15, fill=1, stroke=1)
    c.setFillColor(BLUE)
    c.roundRect(x, y, 172, h, 15, fill=1, stroke=0)
    c.rect(x + 150, y, 22, h, fill=1, stroke=0)
    text(c, "RUNTIME & CONTRACTS", x + 86, y + 22, 12, WHITE, "SegoeBold", "center")
    tokens = [
        "BFF", "SSE", "AgentEvent", "A2UIBlock", "CanvasCommand",
        "ChangeSet", "Workspace isolation", "Diff", "Approval", "Undo"
    ]
    cursor = x + 190
    for token in tokens:
        token_w = pdfmetrics.stringWidth(token, "Segoe", 9.2) + 18
        if cursor + token_w > x + w - 12:
            break
        c.setFillColor(PALE)
        c.roundRect(cursor, y + 16, token_w, 24, 12, fill=1, stroke=0)
        text(c, token, cursor + token_w / 2, y + 23, 9.2, BLUE_DARK, "Segoe", "center")
        cursor += token_w + 7


def build():
    register_fonts()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(W, H))
    c.setTitle("MeshCLI Technical Architecture - One Page")
    c.setAuthor("MeshCLI")

    background(c)
    text(c, "MESHCLI", 54, 488, 34, INK, "SegoeBold")
    text(c, "TECHNICAL ARCHITECTURE", 220, 491, 14, BLUE_DARK, "Cascadia")
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    c.line(54, 470, 906, 470)

    connector(c, 318, 367, 402, 318, 42)
    connector(c, 318, 205, 402, 258, 42)
    connector(c, 642, 367, 558, 318, -42)
    connector(c, 642, 205, 558, 258, -42)

    section(c, 54, 294, 264, "MESH", [
        "Graph workspace", "Nodes + edges",
        "Branching", "Non-linear reasoning",
        "Context inheritance", "Merge + compare",
        "Visual topology", "Structured knowledge",
    ], BLUE)

    section(c, 54, 132, 264, "AGENT CONTROL", [
        "SDK", "CLI-first",
        "LangGraph", "MCP",
        "Skills + tools", "Parallel agents",
        "Supervisor / executor", "Plan / review / apply",
    ], CYAN)

    section(c, 642, 294, 264, "UNIFIED API", [
        "Provider-agnostic", "OpenAI-compatible",
        "Model adapters", "Configure once",
        "Settings", "Secrets",
        "Streaming / SSE", "Typed payloads",
    ], BLUE)

    section(c, 642, 132, 264, "INTERFACE", [
        "A2UI", "AG-UI",
        "MCP Apps", "Generative UI",
        "Actionable UI", "Live state",
        "Canvas commands", "Human approval",
    ], CYAN)

    core(c)
    foundation(c)
    c.showPage()
    c.save()
    print(OUT)


if __name__ == "__main__":
    build()
