"""
Generate demo sci-fi scene video assets for the Turing-Complete Canvas.

Produces:
  - /public/canvas/scene_main.mp4   - Main scene (server room, looping)
  - /public/canvas/branch_alert.mp4 - Branch: alert triggered (red emergency lighting)
  - /public/canvas/branch_reboot.mp4 - Branch: reboot sequence (cool blue pulses)
  - /public/canvas/branch_neutral.mp4 - Branch: neutral continuation

Uses procedural canvas rendering with PIL + OpenCV to draw:
  - Server racks with blinking LEDs
  - Sparking server rack (clickable object A)
  - Control terminal screen (clickable object B)
  - Cooling vent (clickable object C)
  - Ambient particle effects / scanlines

Coordinates of clickable objects are also exported as JSON.
"""
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import json
import math
import os
import random

random.seed(42)
np.random.seed(42)

W, H = 1280, 720
FPS = 30
DURATION_SEC = 6
TOTAL_FRAMES = FPS * DURATION_SEC  # 180 frames (satisfies LTX n*8+1 -> 8*22+1=177, close enough for demo)

OUT_DIR = "/home/z/my-project/public/canvas"
os.makedirs(OUT_DIR, exist_ok=True)

# Clickable object bounding boxes (in normalized 0-1 coordinates)
# These are the "semantic" objects Florence-2 would detect
OBJECTS = {
    "server_rack_sparking": {
        "label": "Server Rack 7-A",
        "bbox": [0.18, 0.20, 0.42, 0.85],  # x1, y1, x2, y2 normalized
        "semantic_role": "faulty_asset",
        "description": "Sparking server rack with failing power supply",
    },
    "control_terminal": {
        "label": "Control Terminal",
        "bbox": [0.55, 0.30, 0.92, 0.78],
        "semantic_role": "operator_interface",
        "description": "Main control terminal displaying system status",
    },
    "cooling_vent": {
        "label": "Cooling Vent",
        "bbox": [0.44, 0.05, 0.62, 0.18],
        "semantic_role": "hvac_component",
        "description": "Overhead cooling vent with temperature readings",
    },
}


def lerp(a, b, t):
    return a + (b - a) * t


def draw_server_room(frame_img, t, mode="main", click_pulses=None):
    """Draw a procedural sci-fi server room.

    Args:
        frame_img: PIL.Image to draw on (RGBA)
        t: time in seconds (float)
        mode: 'main' | 'alert' | 'reboot' | 'neutral'
        click_pulses: list of (x_norm, y_norm, age_sec) for click highlights
    """
    draw = ImageDraw.Draw(frame_img, "RGBA")

    # Background gradient based on mode
    if mode == "main":
        bg_top = (8, 12, 22, 255)
        bg_bot = (20, 28, 45, 255)
        accent = (0, 200, 255, 255)
        spark_intensity = 1.0
    elif mode == "alert":
        bg_top = (40, 6, 8, 255)
        bg_bot = (70, 14, 18, 255)
        accent = (255, 60, 60, 255)
        spark_intensity = 1.6
        # Pulsing red alert
        alert_pulse = abs(math.sin(t * 4.0)) * 0.4 + 0.3
        draw.rectangle([0, 0, W, H], fill=(int(120 * alert_pulse), 0, 0, 80))
    elif mode == "reboot":
        bg_top = (4, 16, 30, 255)
        bg_bot = (8, 30, 60, 255)
        accent = (80, 180, 255, 255)
        spark_intensity = 0.0
        # Cool blue pulse sweeping
        sweep = (math.sin(t * 2.0) * 0.5 + 0.5)
        draw.rectangle([0, int(H * sweep - 40), W, int(H * sweep + 40)], fill=(50, 120, 200, 50))
    else:  # neutral
        bg_top = (8, 12, 22, 255)
        bg_bot = (20, 28, 45, 255)
        accent = (0, 200, 255, 255)
        spark_intensity = 0.0

    # Gradient background
    for y in range(0, H, 4):
        ratio = y / H
        r = int(lerp(bg_top[0], bg_bot[0], ratio))
        g = int(lerp(bg_top[1], bg_bot[1], ratio))
        b = int(lerp(bg_top[2], bg_bot[2], ratio))
        draw.rectangle([0, y, W, y + 4], fill=(r, g, b, 255))

    # Floor perspective grid
    grid_color = (60, 90, 130, 90) if mode != "alert" else (160, 60, 60, 90)
    horizon = int(H * 0.55)
    # Horizontal floor lines (perspective)
    for i in range(1, 20):
        progress = i / 19.0
        y = horizon + int((H - horizon) * (progress ** 2))
        alpha = int(120 * (1 - progress * 0.5))
        draw.line([(0, y), (W, y)], fill=grid_color[:3] + (alpha,), width=1)
    # Vertical perspective lines converging to vanishing point
    vp_x, vp_y = W // 2, horizon
    for i in range(-10, 11):
        x_base = W // 2 + i * 90
        draw.line([(x_base, H), (vp_x, vp_y)], fill=grid_color, width=1)

    # ====== Server rack 7-A (sparking) ======
    rack_x1, rack_y1, rack_x2, rack_y2 = (
        int(OBJECTS["server_rack_sparking"]["bbox"][0] * W),
        int(OBJECTS["server_rack_sparking"]["bbox"][1] * H),
        int(OBJECTS["server_rack_sparking"]["bbox"][2] * W),
        int(OBJECTS["server_rack_sparking"]["bbox"][3] * H),
    )
    # Rack frame
    draw.rectangle([rack_x1, rack_y1, rack_x2, rack_y2], outline=(120, 140, 160, 255), width=3)
    draw.rectangle([rack_x1 + 4, rack_y1 + 4, rack_x2 - 4, rack_y2 - 4], outline=(80, 100, 130, 180), width=1)
    # Rack units with blinking LEDs
    rack_w = rack_x2 - rack_x1
    rack_h = rack_y2 - rack_y1
    n_units = 12
    unit_h = rack_h / n_units
    for i in range(n_units):
        uy = int(rack_y1 + 8 + i * unit_h)
        uh = int(unit_h - 4)
        # Unit panel
        draw.rectangle([rack_x1 + 8, uy, rack_x2 - 8, uy + uh], fill=(20, 28, 42, 255), outline=(60, 80, 110, 255))
        # LEDs
        led_y = uy + uh // 2
        for j in range(5):
            led_x = rack_x1 + 18 + j * 14
            led_on = (int(t * (3 + i * 0.7 + j * 0.3)) % 4) != 0
            if mode == "alert" and i in (5, 6, 7):
                led_color = (255, 60, 60, 255) if led_on else (90, 20, 20, 255)
            elif mode == "reboot":
                led_color = (80, 180, 255, 255) if (int(t * 5) + i) % 3 == 0 else (20, 50, 80, 255)
            else:
                led_color = (0, 255, 140, 255) if led_on else (0, 70, 40, 255)
            draw.ellipse([led_x - 2, led_y - 2, led_x + 2, led_y + 2], fill=led_color)

    # Sparks on rack (main mode + alert mode)
    if spark_intensity > 0:
        n_sparks = int(8 * spark_intensity + 4 * math.sin(t * 12))
        for s in range(max(1, n_sparks)):
            sx = random.randint(rack_x1 + 10, rack_x2 - 10)
            sy = random.randint(rack_y1 + int(rack_h * 0.4), rack_y2 - 20)
            sr = random.randint(2, 5)
            # Bright spark
            draw.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(255, 240, 180, 255))
            # Spark trail
            for k in range(1, 6):
                kx = sx + random.randint(-15, 15) * k // 2
                ky = sy + random.randint(-10, 15) * k // 2
                kr = max(1, sr - k)
                alpha = max(0, 255 - k * 50)
                draw.ellipse([kx - kr, ky - kr, kx + kr, ky + kr], fill=(255, 180, 80, alpha))
        # Electric arc lines
        for _ in range(2):
            x1 = random.randint(rack_x1, rack_x2)
            y1 = random.randint(rack_y1 + int(rack_h * 0.4), rack_y2)
            prev = (x1, y1)
            for _ in range(6):
                nx = prev[0] + random.randint(-20, 20)
                ny = prev[1] + random.randint(-5, 15)
                draw.line([prev, (nx, ny)], fill=(255, 255, 220, 220), width=1)
                prev = (nx, ny)

    # ====== Control terminal (right side) ======
    term_x1 = int(OBJECTS["control_terminal"]["bbox"][0] * W)
    term_y1 = int(OBJECTS["control_terminal"]["bbox"][1] * H)
    term_x2 = int(OBJECTS["control_terminal"]["bbox"][2] * W)
    term_y2 = int(OBJECTS["control_terminal"]["bbox"][3] * H)
    # Terminal frame
    draw.rectangle([term_x1, term_y1, term_x2, term_y2], fill=(10, 14, 24, 230), outline=(0, 200, 255, 200), width=2)
    # Terminal header
    draw.rectangle([term_x1, term_y1, term_x2, term_y1 + 28], fill=(0, 30, 50, 255))
    try:
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 14)
        font_md = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 18)
        font_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
    except Exception:
        font_sm = ImageFont.load_default()
        font_md = ImageFont.load_default()
        font_lg = ImageFont.load_default()
    draw.text((term_x1 + 12, term_y1 + 6), "TERMINAL // OPERATOR", fill=(0, 220, 255, 255), font=font_md)
    # Terminal lines (typewriter effect)
    term_lines = [
        "> sys.status = OK" if mode == "main" else ("> sys.status = ALERT" if mode == "alert" else "> sys.status = REBOOT"),
        "> rack.7a: " + ("FAULT" if mode in ("main", "alert") else "RESET"),
        "> power.load: " + ("87%" if mode == "main" else ("112% !!!" if mode == "alert" else "24%")),
        "> cooling.temp: " + ("24.1C" if mode == "main" else ("31.8C !" if mode == "alert" else "22.0C")),
        "> user.input: awaiting",
        ">",
    ]
    visible_lines = min(len(term_lines), int(t * 2.5) + 1)
    for li, line in enumerate(term_lines[:visible_lines]):
        ty = term_y1 + 40 + li * 22
        # Color depends on content
        if "ALERT" in line or "!!!" in line or "FAULT" in line:
            col = (255, 100, 100, 255)
        elif "OK" in line or "RESET" in line:
            col = (100, 255, 140, 255)
        else:
            col = (180, 220, 255, 255)
        draw.text((term_x1 + 14, ty), line, fill=col, font=font_sm)
    # Blinking cursor
    if visible_lines >= 1 and int(t * 3) % 2 == 0:
        cy = term_y1 + 40 + (visible_lines - 1) * 22
        draw.rectangle([term_x1 + 14 + 130, cy, term_x1 + 14 + 138, cy + 14], fill=(0, 220, 255, 255))

    # ====== Cooling vent (top center) ======
    vent_x1 = int(OBJECTS["cooling_vent"]["bbox"][0] * W)
    vent_y1 = int(OBJECTS["cooling_vent"]["bbox"][1] * H)
    vent_x2 = int(OBJECTS["cooling_vent"]["bbox"][2] * W)
    vent_y2 = int(OBJECTS["cooling_vent"]["bbox"][3] * H)
    draw.rectangle([vent_x1, vent_y1, vent_x2, vent_y2], fill=(30, 38, 55, 255), outline=(120, 140, 170, 255), width=2)
    # Vent slats
    for i in range(6):
        vy = vent_y1 + 8 + i * (vent_y2 - vent_y1 - 16) // 5
        draw.line([(vent_x1 + 10, vy), (vent_x2 - 10, vy)], fill=(80, 100, 130, 255), width=2)
    # Temperature readout
    temp_text = "24.1°C" if mode == "main" else ("31.8°C !" if mode == "alert" else "22.0°C")
    draw.text((vent_x1 + 4, vent_y2 + 4), temp_text, fill=(150, 220, 255, 255), font=font_sm)
    # Cooling particles
    if mode in ("main", "neutral"):
        for _ in range(8):
            px = random.randint(vent_x1 + 6, vent_x2 - 6)
            py = random.randint(vent_y2, vent_y2 + 60)
            pa = random.randint(40, 120)
            draw.ellipse([px - 1, py - 1, px + 1, py + 1], fill=(180, 220, 255, pa))

    # ====== Ambient particles (floating dust) ======
    for _ in range(20):
        px = random.randint(0, W)
        py = random.randint(0, H)
        pa = random.randint(20, 80)
        draw.ellipse([px - 1, py - 1, px + 1, py + 1], fill=(150, 180, 220, pa))

    # ====== Scanlines (CRT effect) ======
    for y in range(0, H, 3):
        draw.line([(0, y), (W, y)], fill=(0, 0, 0, 25))

    # ====== Click pulses (user interaction feedback) ======
    if click_pulses:
        for px_n, py_n, age in click_pulses:
            px = int(px_n * W)
            py = int(py_n * H)
            radius = int(age * 200)
            alpha = max(0, int(255 * (1 - age / 1.0)))
            if alpha > 0:
                draw.ellipse([px - radius, py - radius, px + radius, py + radius], outline=(0, 255, 220, alpha), width=3)

    # ====== HUD overlay (top corners) ======
    # Top-left status
    draw.text((20, 20), "TURING-CANVAS // v0.1", fill=(0, 220, 255, 220), font=font_md)
    status_text = "STATUS: NOMINAL" if mode == "main" else ("STATUS: ALERT" if mode == "alert" else "STATUS: REBOOT")
    status_col = (100, 255, 140, 220) if mode == "main" else ((255, 100, 100, 220) if mode == "alert" else (80, 180, 255, 220))
    draw.text((20, 44), status_text, fill=status_col, font=font_sm)
    # Top-right timestamp
    draw.text((W - 200, 20), f"T+{t:06.2f}s", fill=(180, 220, 255, 220), font=font_md)
    draw.text((W - 200, 44), f"FPS:{FPS}  {W}x{H}", fill=(150, 180, 220, 200), font=font_sm)

    # ====== Vignette ======
    vignette = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    vd.rectangle([0, 0, W, H], fill=180)
    for i in range(80):
        alpha_val = int(80 * (i / 80))
        vd.rectangle([i, i, W - i, H - i], outline=alpha_val)
    vignette = vignette.filter(__import__('PIL').ImageFilter.GaussianBlur(40)) if hasattr(__import__('PIL'), 'ImageFilter') else vignette
    black = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    black.putalpha(vignette)
    frame_img.paste(black, (0, 0), black)


def render_video(mode, out_path, duration_sec=DURATION_SEC, fps=FPS):
    """Render a procedural video. Writes to a temp file with mp4v, then
    re-encodes to H.264 (mp4) with ffmpeg so browsers can play it."""
    import subprocess
    import os
    tmp_path = out_path + ".raw.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    vw = cv2.VideoWriter(tmp_path, fourcc, fps, (W, H))
    n_frames = fps * duration_sec
    for fi in range(n_frames):
        t = fi / fps
        img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        draw_server_room(img, t, mode=mode)
        # Composite onto black
        bg = Image.new("RGB", (W, H), (0, 0, 0))
        bg.paste(img, (0, 0), img)
        arr = np.array(bg)[:, :, ::-1]  # RGB -> BGR
        vw.write(arr)
    vw.release()
    # Re-encode to H.264 mp4 with yuv420p for browser compatibility
    try:
        subprocess.run([
            "ffmpeg", "-y", "-i", tmp_path,
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-crf", "23", "-preset", "fast",
            out_path
        ], check=True, capture_output=True)
        os.remove(tmp_path)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        # Fallback: just rename the mp4v file (will not play in browsers but useful for debugging)
        print(f"  ffmpeg failed ({e}), keeping mp4v version")
        os.rename(tmp_path, out_path)
    print(f"Wrote {out_path}  ({n_frames} frames)")


def main():
    print("Generating Turing-Complete Canvas demo assets...")
    # Main scene
    render_video("main", os.path.join(OUT_DIR, "scene_main.mp4"))
    # Alert branch
    render_video("alert", os.path.join(OUT_DIR, "branch_alert.mp4"))
    # Reboot branch
    render_video("reboot", os.path.join(OUT_DIR, "branch_reboot.mp4"))
    # Neutral continuation
    render_video("neutral", os.path.join(OUT_DIR, "branch_neutral.mp4"))

    # Export object metadata
    with open(os.path.join(OUT_DIR, "scene_objects.json"), "w") as f:
        json.dump({
            "objects": OBJECTS,
            "video_dimensions": {"width": W, "height": H, "fps": FPS},
        }, f, indent=2)
    print(f"Wrote scene_objects.json")

    # Export a poster frame
    poster = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    draw_server_room(poster, 1.5, mode="main")
    bg = Image.new("RGB", (W, H), (0, 0, 0))
    bg.paste(poster, (0, 0), poster)
    bg.save(os.path.join(OUT_DIR, "poster.jpg"), quality=85)
    print(f"Wrote poster.jpg")
    print("Done.")


if __name__ == "__main__":
    main()
