"""
Generate cutting-room demo video assets for The Turing-Complete Canvas.

Produces a 1970s cutting room, paused mid-edit, with seven clickable
objects (Steenbeck flatbed, Bolex on tripod, Royal typewriter, cold coffee,
green-illuminated wall intercom, vertical light shaft, narrow Pacific
window) at the same normalised bboxes the runtime serves in demo mode.

Outputs (the same filenames the runtime expects in public/canvas/):
  - /public/canvas/scene_main.mp4    - boot / null hypothesis / 'taking'
  - /public/canvas/branch_alert.mp4  - active beat (reels turning / light leak / door visible stage-left)
  - /public/canvas/branch_reboot.mp4 - the room acknowledging an edit (low emotional curve)
  - /public/canvas/branch_neutral.mp4 - gentle continuation / paused again
  - /public/canvas/poster.jpg        - intro poster
  - /public/canvas/scene_objects.json - the same object map the runtime reads

All footage is procedural (PIL + OpenCV), intentionally desaturated to the
16mm register to pass as scrim. Swap these out for licensed / generated
footage per README -> "Demo assets" before submitting.
"""
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import json
import math
import os
import random

random.seed(7)
np.random.seed(7)

W, H = 1280, 720
FPS = 24
DURATION_SEC = 6
TOTAL_FRAMES = FPS * DURATION_SEC

# Output dir is resolved relative to this script so it works wherever it runs.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "public", "canvas"))
os.makedirs(OUT_DIR, exist_ok=True)

# The seven clickable objects. bboxes match the demo detections in
# src/lib/canvas/fal-client.ts and public/canvas/scene_objects.json.
OBJECTS = {
    "steenbeck_reels": {
        "label": "Steenbeck Flatbed",
        "bbox": [0.06, 0.42, 0.46, 0.86],
        "semantic_role": "film_source",
        "description": "16mm flatbed film editor with two reels and a splice block.",
    },
    "bolex_tripod": {
        "label": "Bolex on Tripod",
        "bbox": [0.62, 0.18, 0.86, 0.72],
        "semantic_role": "camera_asset",
        "description": "A Bolex H16 on a tripod, lens cap off, pointed across the room.",
    },
    "typewriter_note": {
        "label": "Royal Typewriter",
        "bbox": [0.4, 0.3, 0.66, 0.62],
        "semantic_role": "manuscript",
        "description": "A Royal typewriter. The carriage is mid-return on an unfinished line.",
    },
    "cold_coffee": {
        "label": "Cold Coffee",
        "bbox": [0.5, 0.66, 0.6, 0.78],
        "semantic_role": "artifact_unset",
        "description": "A mug of coffee gone cold. No steam. The ring stain under it says three days.",
    },
    "wall_intercom": {
        "label": "Wall Intercom",
        "bbox": [0.84, 0.08, 0.97, 0.3],
        "semantic_role": "operator_interface",
        "description": "A green-illuminated wall intercom. The only thing in the room that still answers.",
    },
    "light_shaft": {
        "label": "Light Shaft",
        "bbox": [0.2, 0.04, 0.4, 0.4],
        "semantic_role": "vfx_element",
        "description": "A long vertical shaft of afternoon light from a high window. The room's grade.",
    },
    "window_ocean": {
        "label": "Window, Pacific",
        "bbox": [0.86, 0.32, 1.0, 0.66],
        "semantic_role": "scene_extern",
        "description": "A tall narrow window onto a grey Pacific coast.",
    },
}

# Mode-specific grade palettes. We keep four modes because the runtime
# already ships four mp4 slots; the demo branch map in store.ts/funcs
# reuses whichever mode fits the chosen narrative beat best.
PALETTES = {
    "main":    {"warm": 0.0, "amber": 0.16, "dust": 1.0, "intercom_pulse": 0.4,  "deep": 0.0},
    "alert":   {"warm": 0.4, "amber": 0.34, "dust": 1.4, "intercom_pulse": 1.0, "deep": 0.0},
    "reboot":  {"warm": 0.0, "amber": 0.06, "dust": 0.6, "intercom_pulse": 0.5,  "deep": 0.4},
    "neutral": {"warm": 0.0, "amber": 0.18, "dust": 0.9, "intercom_pulse": 0.3,  "deep": 0.0},
}


def _font(size, bold=False):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def lerp(a, b, t):
    return a + (b - a) * t


def _vignette_alpha():
    vignette = Image.new("L", (W, H), 0)
    vd = ImageDraw.Draw(vignette)
    vd.rectangle([0, 0, W, H], fill=240)
    for i in range(120):
        a = int(110 * (i / 120))
        vd.rectangle([i, i, W - i, H - i], outline=a)
    return vignette.filter(ImageFilter.GaussianBlur(60))


_VIGNETTE = None


def draw_cutting_room(img, t, mode="main"):
    """Draw a procedural 16mm cutting room. Returns the composited RGBA frame."""
    pal = PALETTES.get(mode, PALETTES["main"])

    global _VIGNETTE
    if _VIGNETTE is None:
        _VIGNETTE = _vignette_alpha()

    draw = ImageDraw.Draw(img, "RGBA")

    # --- Background warm-to-cool wall gradient (overall 16mm register)
    warm = pal["warm"]
    top = (int(lerp(22, 38, warm)), int(lerp(18, 26, warm)), int(lerp(20, 22, warm)))
    bot = (int(lerp(8, 16, warm)),  int(lerp(6, 12, warm)),  int(lerp(8, 14, warm)))
    for y in range(0, H, 3):
        r = int(lerp(top[0], bot[0], y / H))
        g = int(lerp(top[1], bot[1], y / H))
        b = int(lerp(top[2], bot[2], y / H))
        draw.rectangle([0, y, W, y + 3], fill=(r, g, b, 255))

    # --- Wooden desk surface (lower third) tilted in pseudo-perspective
    desk_y0 = int(H * 0.56)
    for y in range(desk_y0, H, 2):
        r = int(lerp(54, 22, (y - desk_y0) / (H - desk_y0)))
        g = int(lerp(36, 14, (y - desk_y0) / (H - desk_y0)))
        b = int(lerp(22, 10, (y - desk_y0) / (H - desk_y0)))
        draw.rectangle([0, y, W, y + 2], fill=(r, g, b, 255))
    # Subtle wood grain hatching
    for _ in range(60):
        gx = random.randint(0, W)
        gy = random.randint(desk_y0, H)
        draw.line([(gx, gy), (gx + random.randint(40, 180), gy - random.randint(1, 3))],
                  fill=(46, 30, 18, 70), width=1)

    # --- Vertical light shaft from the high window (object light_shaft)
    ls = OBJECTS["light_shaft"]["bbox"]
    lx0 = int(ls[0] * W)
    ly0 = int(ls[1] * H)
    lx1 = int(ls[2] * W)
    ly1 = int(ls[3] * H)
    for k in range(40):
        x = lerp(lx0, lx0 + 60, k / 40)
        alpha = int(80 * (1 - k / 40))
        shaft_poly = [
            (x + k, ly0),
            (x + 60 + k, ly0),
            (x + 240 + k * 1.4, H),
            (x - 80 + k * 1.4, H),
        ]
        amber = int(lerp(110, 220, pal["amber"]))
        yellow = int(lerp(80, 180, pal["amber"]))
        if pal["deep"] > 0:
            amber = int(amber * (1 - pal["deep"]))
            yellow = int(yellow * (1 - pal["deep"]))
        draw.polygon(shaft_poly, fill=(amber, yellow, 90, alpha))

    # --- Dust drifting through the light shaft (and ambient)
    for _ in range(int(160 * pal["dust"])):
        in_shaft = random.random() < 0.55
        if in_shaft:
            px = random.randint(lx0, lx0 + 300)
            py = random.randint(ly0, min(H, ly0 + int((H - ly0) * (px - lx0) / 200 + 60)))
            # bias alpha toward shaft
            a = random.randint(50, 140)
            col = (220, 200, 150, a)
        else:
            px = random.randint(0, W)
            py = random.randint(0, H)
            a = random.randint(20, 70)
            col = (200, 190, 170, a)
        r = random.choice([1, 1, 1, 2])
        draw.ellipse([px - r, py - r, px + r, py + r], fill=col)

    # --- Steenbeck flatbed editor (object steenbeck_reels), lower-left on desk
    sk = OBJECTS["steenbeck_reels"]["bbox"]
    sx1, sy1 = int(sk[0] * W), int(sk[1] * H)
    sx2, sy2 = int(sk[2] * W), int(sk[3] * H)
    # base
    draw.rectangle([sx1, sy1, sx2, sy2], fill=(36, 28, 22, 255), outline=(96, 78, 56, 220), width=3)
    draw.rectangle([sx1 + 4, sy1 + 4, sx2 - 4, sy2 - 4], outline=(70, 56, 42, 180), width=1)
    # Two reels as concentric circles
    reel_r = min((sx2 - sx1) // 5, (sy2 - sy1) // 4)
    for ri, (cx_offset, label_col) in enumerate([
        (sx1 + reel_r + 24, (200, 170, 110, 220)),
        (sx2 - reel_r - 24, (180, 150, 90, 200)),
    ]):
        cx = cx_offset
        cy = (sy1 + sy2) // 2 - 6
        # reel base ring
        draw.ellipse([cx - reel_r, cy - reel_r, cx + reel_r, cy + reel_r],
                     fill=(22, 18, 14, 255), outline=label_col[:3] + (220,), width=2)
        # spokes (turn slowly; in 'alert' mode they actually rotate visibly)
        spin = (t * 0.4 if mode == "alert" else t * 0.04)
        for s in range(6):
            a = s / 6 * 2 * math.pi + spin
            ex = int(cx + math.cos(a) * reel_r * 0.86)
            ey = int(cy + math.sin(a) * reel_r * 0.86)
            draw.line([(cx, cy), (ex, ey)], fill=(70, 58, 42, 220), width=2)
        # hub
        draw.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(140, 110, 70, 255))
    # Splice block centered between reels
    splice_x = (sx1 + sx2) // 2
    splice_y = (sy1 + sy2) // 2
    draw.rectangle([splice_x - 30, splice_y - 10, splice_x + 30, splice_y + 10],
                   fill=(60, 50, 38, 255), outline=(180, 150, 90, 220), width=1)
    # A strip of leader hanging from the splice block
    draw.rectangle([splice_x - 4, splice_y + 11, splice_x + 4, splice_y + 36],
                   fill=(220, 220, 200, 200), outline=(160, 160, 140, 220), width=1)

    # --- Bolex on tripod (object bolex_tripod), upper-right corner
    bx = OBJECTS["bolex_tripod"]["bbox"]
    bx1, by1 = int(bx[0] * W), int(bx[1] * H)
    bx2, by2 = int(bx[2] * W), int(bx[3] * H)
    # Tripod legs
    trip_cx = (bx1 + bx2) // 2
    trip_top_y = (by1 + by2) // 2 + 8
    for spread in (-46, 0, 46):
        draw.line([(trip_cx, trip_top_y), (trip_cx + spread, by2)], fill=(60, 50, 42, 255), width=3)
    # Tripod head
    draw.ellipse([trip_cx - 8, trip_top_y - 10, trip_cx + 8, trip_top_y + 4], fill=(90, 76, 58, 255))
    # Camera body (rectangle on top of head)
    cam_w = (bx2 - bx1) // 3
    cam_h = cam_w // 2
    cam_x0 = trip_cx - cam_w // 2
    cam_y0 = by1 + 6
    draw.rectangle([cam_x0, cam_y0, cam_x0 + cam_w, cam_y0 + cam_h],
                   fill=(20, 22, 24, 255), outline=(120, 110, 96, 220), width=2)
    # Lens (cylinder)
    lens_len = cam_w // 3
    draw.rectangle([cam_x0 + cam_w - 6, cam_y0 + cam_h // 2 - 10,
                    cam_x0 + cam_w + lens_len, cam_y0 + cam_h // 2 + 10],
                   fill=(10, 12, 14, 255), outline=(160, 150, 130, 220), width=1)
    # Lens cap off (visible as a glint on the glass)
    glint_a = int(120 + 60 * math.sin(t * 1.6))
    draw.ellipse([cam_x0 + cam_w + lens_len - 6, cam_y0 + cam_h // 2 - 4,
                  cam_x0 + cam_w + lens_len + 2, cam_y0 + cam_h // 2 + 4],
                 fill=(220, 210, 180, glint_a))

    # --- Royal typewriter + paper page (object typewriter_note), center desk
    tw = OBJECTS["typewriter_note"]["bbox"]
    tx1, ty1 = int(tw[0] * W), int(tw[1] * H)
    tx2, ty2 = int(tw[2] * W), int(tw[3] * H)
    # typewriter body
    draw.rectangle([tx1, ty1, tx2, ty2], fill=(34, 30, 28, 255), outline=(100, 86, 70, 220), width=2)
    draw.rectangle([tx1 + 4, ty1 + 4, tx2 - 4, ty2 - 4], outline=(70, 60, 50, 180), width=1)
    # platen + paper inserted at top
    paper_x0 = tx1 + 12
    paper_y0 = ty1 - 50
    paper_x1 = tx2 - 12
    paper_y1 = ty1 + 18
    draw.rectangle([paper_x0, paper_y0, paper_x1, paper_y1], fill=(224, 218, 200, 255),
                   outline=(140, 130, 110, 220), width=1)
    # typed lines — last line is unfinished (carriage mid-return). Slowly type it.
    lines = [
        "and the room was left",
        "as it was, un—",
        "",
    ]
    font_tw = _font(18)
    line_h = 22
    for li, ln in enumerate(lines):
        ly = paper_y0 + 12 + li * line_h
        if li < len(lines) - 1:
            draw.text((paper_x0 + 12, ly), ln, fill=(40, 30, 24, 240), font=font_tw)
        else:
            # last line: animate the cursor on the unfinished line if active in 'alert' mode
            n_chars = int(t * 6) if mode == "alert" else 0
            draw.text((paper_x0 + 12, ly), "un" + ("—"[:0]), fill=(40, 30, 24, 240), font=font_tw)
            # blinking carriage cursor
            if int(t * 2) % 2 == 0:
                draw.rectangle([paper_x0 + 14 + 30, ly + 2, paper_x0 + 14 + 36, ly + 16],
                               fill=(30, 22, 18, 240))
    # keys on the body
    for r in range(3):
        for c in range(10):
            kx = tx1 + 16 + c * 18
            ky = ty1 + 30 + r * 14
            draw.ellipse([kx - 4, ky - 4, kx + 4, ky + 4], fill=(20, 16, 14, 255),
                         outline=(120, 100, 80, 220), width=1)

    # --- Cold mug of coffee (object cold_coffee), on the desk beside the typewriter
    cc = OBJECTS["cold_coffee"]["bbox"]
    cx1, cy1 = int(cc[0] * W), int(cc[1] * H)
    cx2, cy2 = int(cc[2] * W), int(cc[3] * H)
    mug_cx = (cx1 + cx2) // 2
    mug_cy = (cy1 + cy2) // 2
    mug_r = (cx2 - cx1) // 2
    # ring stain under the mug (3-day pause tells you the time)
    draw.ellipse([mug_cx - mug_r - 4, mug_cy + mug_r - 4, mug_cx + mug_r + 4, mug_cy + mug_r + 8],
                 fill=(40, 28, 16, 110))
    # mug body (trapezoid)
    draw.polygon([
        (mug_cx - mug_r, mug_cy - mug_r),
        (mug_cx + mug_r, mug_cy - mug_r),
        (mug_cx + mug_r - 3, mug_cy + mug_r),
        (mug_cx - mug_r + 3, mug_cy + mug_r),
    ], fill=(190, 184, 168, 255), outline=(150, 140, 120, 240))
    # coffee surface (flat, no steam)
    draw.ellipse([mug_cx - mug_r + 2, mug_cy - mug_r + 2, mug_cx + mug_r - 2, mug_cy - mug_r + 10],
                 fill=(48, 30, 20, 255), outline=(70, 46, 28, 240))
    # handle
    draw.arc([mug_cx + mug_r - 2, mug_cy - mug_r // 2, mug_cx + mug_r + 18, mug_cy + mug_r // 2],
             270, 90, fill=(190, 184, 168, 255), width=4)

    # --- Green wall intercom (object wall_intercom), upper right
    ic = OBJECTS["wall_intercom"]["bbox"]
    ix1, iy1 = int(ic[0] * W), int(ic[1] * H)
    ix2, iy2 = int(ic[2] * W), int(ic[3] * H)
    draw.rectangle([ix1, iy1, ix2, iy2], fill=(28, 30, 28, 255), outline=(140, 150, 130, 220), width=2)
    # speaker grille
    for ri in range(4):
        sy = iy1 + 8 + ri * 10
        draw.line([(ix1 + 8, sy), (ix2 - 8, sy)], fill=(110, 120, 100, 200), width=2)
    # pulsing green light (the room's only "answered" thing)
    pulse = abs(math.sin(t * 2.2)) * pal["intercom_pulse"] + 0.15
    green_a = int(110 + 110 * pulse)
    led_x = ix2 - 10
    led_y = iy2 - 8
    draw.ellipse([led_x - 6, led_y - 6, led_x + 6, led_y + 6],
                 fill=(40, 200, 80, green_a))
    # halo
    halo_a = int(40 * pulse)
    draw.ellipse([led_x - 22, led_y - 22, led_x + 22, led_y + 22],
                 outline=(40, 200, 80, halo_a), width=2)

    # --- Tall narrow window onto Pacific (object window_ocean), right edge
    wn = OBJECTS["window_ocean"]["bbox"]
    wx1, wy1 = int(wn[0] * W), int(wn[1] * H)
    wx2, wy2 = int(wn[2] * W), int(wn[3] * H)
    # glass: grey Pacific gradient
    for y in range(wy1, wy2, 3):
        r = int(lerp(120, 70, (y - wy1) / (wy2 - wy1)))
        g = int(lerp(130, 80, (y - wy1) / (wy2 - wy1)))
        b = int(lerp(140, 96, (y - wy1) / (wy2 - wy1)))
        draw.rectangle([wx1, y, wx2, y + 3], fill=(r, g, b, 255))
    # distant surf line — the only thing in the room that moves on its own
    surf_y = wy1 + (wy2 - wy1) // 2 + int(math.sin(t * 1.2) * 4)
    draw.line([(wx1 + 4, surf_y), (wx2 - 4, surf_y)], fill=(180, 190, 200, 180), width=2)
    # window frame
    draw.rectangle([wx1, wy1, wx2, wy2], outline=(40, 36, 30, 255), width=3)
    draw.line([(wx1, (wy1 + wy2) // 2), (wx2, (wy1 + wy2) // 2)], fill=(40, 36, 30, 255), width=2)

    # --- Far door (stage-left): only really visible in 'alert' (active) mode
    if mode == "alert":
        door_x = 0
        door_w = 6
        door_a = int(160 + 40 * math.sin(t * 0.8))
        draw.rectangle([door_x, int(H * 0.3), door_x + door_w, int(H * 0.92)],
                       fill=(220, 200, 150, door_a))

    # --- HUD: minimal, in the corner, like a slate annotation (not a system alert)
    font_sl = _font(14)
    font_lg = _font(22, bold=True)
    draw.text((20, 18), "CUTTING ROOM 7   TAKE 07", fill=(220, 200, 170, 220), font=font_lg)
    sub_map = {"main": "PAUSED · NULL HYPOTHESIS", "alert": "ACTIVE · EDIT IN PROGRESS",
               "reboot": "ROOM ACKNOWLEDGES", "neutral": "PAUSED · AFTER"}
    draw.text((20, 44), sub_map.get(mode, sub_map["neutral"]), fill=(200, 180, 150, 180), font=font_sl)
    draw.text((W - 130, 18), f"{t:05.2f}s · 16mm", fill=(200, 180, 150, 180), font=font_sl)

    # --- Film grain
    grain = np.random.randint(0, 24, (H // 2, W // 2), dtype=np.uint8)
    grain_img = Image.fromarray(grain, mode="L").resize((W, H))
    grain_rgba = grain_img.convert("RGBA")
    img.paste(grain_rgba, (0, 0), grain_rgba)

    # --- Vignette
    black = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    black.putalpha(_VIGNETTE)
    img.paste(black, (0, 0), black)


def render_video(mode, out_path, duration_sec=DURATION_SEC, fps=FPS):
    import subprocess
    tmp_path = out_path + ".raw.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    vw = cv2.VideoWriter(tmp_path, fourcc, fps, (W, H))
    n_frames = fps * duration_sec
    for fi in range(n_frames):
        t = fi / fps
        img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        draw_cutting_room(img, t, mode=mode)
        bg = Image.new("RGB", (W, H), (0, 0, 0))
        bg.paste(img, (0, 0), img)
        arr = np.array(bg)[:, :, ::-1]
        vw.write(arr)
    vw.release()
    try:
        subprocess.run([
            "ffmpeg", "-y", "-i", tmp_path,
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-crf", "23", "-preset", "fast",
            out_path,
        ], check=True, capture_output=True)
        os.remove(tmp_path)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"  ffmpeg failed ({e}), keeping mp4v version")
        os.rename(tmp_path, out_path)
    print(f"Wrote {out_path}  ({n_frames} frames)")


def main():
    print("Generating Turing-Complete Canvas cutting-room demo assets...")
    render_video("main", os.path.join(OUT_DIR, "scene_main.mp4"))
    render_video("alert", os.path.join(OUT_DIR, "branch_alert.mp4"))
    render_video("reboot", os.path.join(OUT_DIR, "branch_reboot.mp4"))
    render_video("neutral", os.path.join(OUT_DIR, "branch_neutral.mp4"))

    with open(os.path.join(OUT_DIR, "scene_objects.json"), "w") as f:
        json.dump({
            "scene": {
                "id": "cutting_room_7",
                "title": "Cutting Room 7",
                "logline": "A filmmaker died mid-edit of her only film. Her cutting room was left as it was. You finish it.",
                "base_prompt": "16mm cutting room, 1974, long vertical light shaft from a high window, dust drifting slowly through the beam, a Steenbeck flatbed film editor on a wooden desk, sleeves of 16mm film hanging from the ceiling, a Royal typewriter with a half-finished page, a cold mug of coffee, a green-illuminated wall intercom, a Bolex on a tripod in the corner with the lens cap off, window onto a grey Pacific coast, everything paused and waiting, cinematic, 24fps, organic grain, anamorphic flare, no people, ambient hum",
            },
            "objects": OBJECTS,
            "video_dimensions": {"width": W, "height": H, "fps": FPS},
        }, f, indent=2)
    print("Wrote scene_objects.json")

    poster = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    draw_cutting_room(poster, 1.6, mode="main")
    bg = Image.new("RGB", (W, H), (0, 0, 0))
    bg.paste(poster, (0, 0), poster)
    bg.save(os.path.join(OUT_DIR, "poster.jpg"), quality=88)
    print("Wrote poster.jpg")
    print("Done.")


if __name__ == "__main__":
    main()
