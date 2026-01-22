#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generate Avery L7651 (38.1 x 21.2 mm — 65 labels/A4) PDF with this layout:

Inside each label (left → right):
- 1 mm left padding
- QR: 19 x 19 mm (square), top-aligned with logo
- 1 mm gap
- Right block (left-aligned vertical stack):
    - Logo: max 18 mm wide x max 10 mm high (kept within both; aspect preserved)
    - Email: 4 pt
    - Phone: 4 pt
    - ID: 6 pt BOLD
- 1 mm right padding

Text block is vertically centered relative to the QR height.
"""

import os
import sys
import csv
import json
import random
import argparse
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.graphics.barcode import qr as rl_qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

# ---------- Constants (mm/points) ----------
A4_W, A4_H = 210.0, 297.0
LABEL_W, LABEL_H = 38.1, 21.2
COLS, ROWS = 5, 13

PADDING_L = 1.0   # mm — left inner padding of a label (label left edge → QR left)
PADDING_R = 1.0   # mm — right inner padding of a label
QR_W = 19.0       # mm
QR_H = 19.0       # mm
GAP = 0      # mm — BASE horizontal gap between the QR and the right stack (logo + text)
LOGO_MAX_W = 19.0 # mm (allow a bit wider; clamped to section)
LOGO_MAX_H = 12.0 # mm (slightly taller)

EMAIL_PT = 4.0
PHONE_PT = 4.0
ID_PT = 7.0

FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
# Narrow appearance: horizontally scale text without changing point size
TEXT_HSCALE = 0.92  # 92% width for a slightly narrower look

PT_TO_MM = 0.352777778  # 1 point = 1/72 in = 0.352777... mm
# Treat 1 px ~ 1 pt in PDF space
PX_TO_MM = PT_TO_MM

# Small vertical alignment tweak so the right section (logo + text)
# visually lines up with the QR, which often has a quiet-zone margin
# inside the image. Positive value lowers the right section.
RIGHT_SECTION_TOP_OFFSET_MM = 1.5

# Nudge the entire content block slightly left for more right-side breathing room
IN_LABEL_X_NUDGE_MM = -1  # mm — global nudge for everything inside a label (negative = shift left)

# Vertical offset to move printing higher (positive = move up, negative = move down)
VERTICAL_UP_OFFSET_MM = 5.0  # mm — move all labels up by this amount

# Column-specific horizontal shifts (as percentage of label width)
# Column 1 (index 0): shift right by 6%
# Column 2 (index 1): shift right by 4%
# Column 3 (index 2): shift right by 2%
COLUMN_SHIFTS_PERCENT = [0.06, 0.04, 0.02, 0.0, 0.0]  # shifts for columns 1-5

# Cycle fonts across labels so you can compare visibility easily
FONT_CANDIDATES = [
    ("Helvetica", "Helvetica-Bold"),
    ("Times-Roman", "Times-Bold"),
    ("Courier", "Courier-Bold"),
]

# Use the font from label 1 for all labels by default
# 0 = first pair in FONT_CANDIDATES (Helvetica)
SELECTED_FONT_INDEX = 0


def rand_id(n=8):
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return ''.join(random.choice(alphabet) for _ in range(n))


def compute_layout_mm():
    """Compute layout with horizontal gutters and equal left/right margins.

    - Base equal gutter: g0 = (A4_W - COLS*LABEL_W) / (COLS + 1)
    - Apply an adjustable scale to reduce or increase inter-column spacing while
      keeping left/right margins equal.
    - Vertical: center the full block of labels on the page (no extra row gutters).
    """
    total_w = COLS * LABEL_W
    total_h = ROWS * LABEL_H

    # Baseline equal gutter
    base_gutter_x = (A4_W - total_w) / (COLS + 1)
    # Scale gutters between columns by 5% reduction as requested
    H_GUTTER_SCALE = 0.95
    gutter_x = base_gutter_x * H_GUTTER_SCALE

    # Choose margins so left == right even after scaling gutters
    # A4_W = 2*m + COLS*LABEL_W + (COLS-1)*gutter_x
    margin_l = (A4_W - total_w - (COLS - 1) * gutter_x) / 2.0
    # Apply vertical offset to move printing higher
    margin_t = (A4_H - total_h) / 2.0 - VERTICAL_UP_OFFSET_MM
    return margin_l, margin_t, gutter_x


def draw_qr_at(c, payload, left_mm, bottom_mm, size_mm):
    # Vector QR (crisp at any DPI)
    widget = rl_qr.QrCodeWidget(payload)
    bounds = widget.getBounds()
    bw = bounds[2] - bounds[0]
    bh = bounds[3] - bounds[1]
    d = Drawing(size_mm * mm, size_mm * mm, transform=[(size_mm * mm) / bw, 0, 0, (size_mm * mm) / bh, 0, 0])
    d.add(widget)
    renderPDF.draw(d, c, left_mm * mm, bottom_mm * mm)


def draw_label(c, x_label_mm, y_top_mm, qr_payload, logo_img, email, phone, uid, font_pair, font_scale=1.1):
    """Draw one label at top-left (x_label_mm, y_top_mm)."""
    # Inner usable bounds
    # Padding around the QR (horizontally):
    #   - PADDING_L controls space from the label's left edge to the QR's left edge.
    #   - PADDING_R controls right-side padding to the label edge.
    #   - IN_LABEL_X_NUDGE_MM shifts the entire block (QR + logo/text) left/right.
    x_left_mm = x_label_mm + PADDING_L + IN_LABEL_X_NUDGE_MM
    x_right_mm = x_label_mm + LABEL_W - PADDING_R + IN_LABEL_X_NUDGE_MM
    usable_w_mm = x_right_mm - x_left_mm

    # QR: left, vertically centered within label height
    qr_x_mm = x_left_mm
    qr_y_bottom_mm = y_top_mm - (LABEL_H - QR_H) / 2.0 - QR_H  # bottom y of QR (mm)

    # Draw vector QR for this uid
    draw_qr_at(c, qr_payload, qr_x_mm, qr_y_bottom_mm, QR_W)

    # Right block origin — reduce QR→logo/text gap further
    GAP_REDUCTION_MM = 0.6  # tighten spacing beyond previous tweak
    gap_mm = max(0.0, GAP - GAP_REDUCTION_MM)  # effective QR → right-stack gap (mm)
    right_x_mm = qr_x_mm + QR_W + gap_mm       # start X of the right stack (logo + text)
    right_w_mm = usable_w_mm - (QR_W + gap_mm)

    # Logo: top-aligned with QR; centered in right section; aspect preserved
    if logo_img is not None:
        # Compute maximum drawable size within the right section
        max_w_mm = min(LOGO_MAX_W, right_w_mm)
        max_h_mm = LOGO_MAX_H
        try:
            img_w_px, img_h_px = logo_img.getSize()
            aspect = img_w_px / float(img_h_px) if img_h_px else 1.0
        except Exception:
            aspect = 1.0

        # Fit image into max_w_mm x max_h_mm preserving aspect
        if max_h_mm * aspect <= max_w_mm:
            draw_h_mm = max_h_mm
            draw_w_mm = draw_h_mm * aspect
        else:
            draw_w_mm = max_w_mm
            draw_h_mm = draw_w_mm / max(aspect, 1e-6)

        # Top align (with small offset) and center horizontally in the right section
        qr_top_mm = qr_y_bottom_mm + QR_H
        align_top_mm = qr_top_mm - RIGHT_SECTION_TOP_OFFSET_MM
        logo_y_bottom_mm = align_top_mm - draw_h_mm
        logo_x_mm = right_x_mm + (right_w_mm - draw_w_mm) / 2.0

        c.drawImage(logo_img,
                    logo_x_mm * mm,
                    logo_y_bottom_mm * mm,
                    width=draw_w_mm * mm,
                    height=draw_h_mm * mm,
                    preserveAspectRatio=True,
                    mask='auto')
    # Anchor text block directly under the logo with a 1 px gap
    if logo_img is not None:
        start_top_mm = logo_y_bottom_mm - PX_TO_MM
    else:
        # If no logo, start just under the QR top for consistency
        start_top_mm = (qr_y_bottom_mm + QR_H) - PX_TO_MM

    # Helper to draw condensed text without changing point size
    def draw_narrow_text(x_mm, y_mm, text, font_name, size_pt, hscale=TEXT_HSCALE, align_center=False):
        c.saveState()
        c.scale(hscale, 1.0)
        c.setFont(font_name, size_pt)
        # Compute pre-scale X so that post-scale alignment matches request
        if align_center:
            w_pts = c.stringWidth(text, font_name, size_pt)
            x_pre = (x_mm * mm) / hscale - (w_pts / 2.0)
        else:
            # Left alignment; compensate x by 1/hscale to keep left edge aligned
            x_pre = (x_mm * mm) / hscale
        c.drawString(x_pre, y_mm * mm, text)
        c.restoreState()

    # Draw texts centered within the right section horizontally
    section_center_x_mm = right_x_mm + right_w_mm / 2.0
    font_normal, font_bold = font_pair
    # Apply a global font scale so all text grows uniformly
    email_pt = EMAIL_PT * font_scale
    phone_pt = PHONE_PT * font_scale
    id_pt = ID_PT * font_scale

    email_y_mm = start_top_mm - (email_pt * PT_TO_MM)
    draw_narrow_text(section_center_x_mm, email_y_mm, email, font_bold, email_pt, align_center=True)

    phone_y_mm = email_y_mm - (phone_pt * 1.2 * PT_TO_MM)
    draw_narrow_text(section_center_x_mm, phone_y_mm, phone, font_bold, phone_pt, align_center=True)

    id_y_mm = phone_y_mm - (id_pt * 1.6 * PT_TO_MM)
    draw_narrow_text(section_center_x_mm, id_y_mm, uid, font_bold, id_pt, align_center=True)


def generate_pdf(output_pdf, logo_path, checkin_base, email, phone, ids=None, out_csv=None, show_grid=False, font_scale=1.1, start_index=1):
    margin_l, margin_t, gutter_x = compute_layout_mm()
    c = canvas.Canvas(output_pdf, pagesize=(A4_W * mm, A4_H * mm))

    logo_img = ImageReader(logo_path) if (logo_path and os.path.exists(logo_path)) else None

    # Build IDs
    if ids is None:
        ids = [rand_id(8) for _ in range(COLS * ROWS)]

    total_slots = COLS * ROWS
    # Place starting at start_index (1-based)
    slot = max(1, int(start_index))
    idx = 0
    for r in range(ROWS):
        for col in range(COLS):
            # Equal horizontal spacing: left margin = gutter_x, and
            # spacing between labels = gutter_x
            x_label_mm = margin_l + col * (LABEL_W + gutter_x)
            # Apply column-specific horizontal shift (as percentage of label width)
            if col < len(COLUMN_SHIFTS_PERCENT):
                column_shift_mm = LABEL_W * COLUMN_SHIFTS_PERCENT[col]
                x_label_mm += column_shift_mm
            # Vertically centered block; rows are stacked without extra vertical gutters
            y_top_mm = A4_H - margin_t - r * LABEL_H
            if show_grid:
                c.setStrokeColor(colors.lightgrey)
                c.setLineWidth(0.25)
                c.rect(x_label_mm * mm, (y_top_mm - LABEL_H) * mm, LABEL_W * mm, LABEL_H * mm, stroke=1, fill=0)
            # Always use the first label's font across all labels
            font_pair = FONT_CANDIDATES[min(max(SELECTED_FONT_INDEX, 0), len(FONT_CANDIDATES)-1)]
            # Compute current slot number (1..65) for this row/col
            current_slot = (r * COLS) + (col + 1)
            if current_slot < slot or idx >= len(ids):
                # leave blank (maybe draw grid only)
                continue
            uid = ids[idx]
            payload = f"{checkin_base.rstrip('/')}/{uid}"
            draw_label(c, x_label_mm, y_top_mm, payload, logo_img, email, phone, uid, font_pair, font_scale)
            idx += 1

    c.showPage()
    c.save()

    if out_csv:
        with open(out_csv, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["index", "id"])
            for i, uid in enumerate(ids, start=1):
                writer.writerow([i, uid])


def main():
    parser = argparse.ArgumentParser(description="Generate Avery L7651 labels PDF (65/A4).")
    parser.add_argument("--logo", default="assets/ES_logo.png", help="Path to the logo image (PNG).")
    parser.add_argument("--checkin-base", default="http://localhost:3000/check-in", help="Base URL for QR payload, e.g., https://your-host/check-in")
    parser.add_argument("--email", default="admin@engsurveys.com.au", help="Email text.")
    parser.add_argument("--phone", default="+61 8 8340 4469", help="Phone text.")
    parser.add_argument("--out", default="labels_L7651_v4.pdf", help="Output PDF path.")
    parser.add_argument("--csv", default="labels_L7651_ids_v4.csv", help="Optional output CSV for IDs.")
    parser.add_argument("--show-grid", action="store_true", help="Overlay Avery grid boundaries for alignment.")
    # Background template support removed per user request
    parser.add_argument("--font-scale", type=float, default=1.1, help="Scale all text sizes uniformly (e.g., 1.1).")
    parser.add_argument("--ids-file", default=None, help="Path to a text/JSON file with IDs (one per line or JSON array)")
    parser.add_argument("--ids", default=None, help="Comma-separated list of IDs to print")
    parser.add_argument("--start-index", type=int, default=1, help="1-based start slot on sheet (for partial sheets)")
    args = parser.parse_args()

    # Build IDs from inputs
    ids = None
    if args.ids_file:
        p = args.ids_file
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as fh:
                txt = fh.read().strip()
                try:
                    arr = json.loads(txt)
                    if isinstance(arr, list):
                        ids = [str(x).strip() for x in arr if str(x).strip()]
                except Exception:
                    # fallback: parse line by line
                    ids = [line.strip() for line in txt.splitlines() if line.strip()]
    if ids is None and args.ids:
        ids = [s.strip() for s in args.ids.split(',') if s.strip()]
    if ids is None:
        ids = [rand_id(8) for _ in range(COLS * ROWS)]

    generate_pdf(
        args.out,
        args.logo,
        args.checkin_base,
        args.email,
        args.phone,
        ids=ids,
        out_csv=args.csv,
        show_grid=args.show_grid,
        font_scale=args.font_scale,
        start_index=args.start_index,
    )
    print(f"Done. PDF -> {args.out}")
    if args.csv:
        print(f"IDs  -> {args.csv}")


if __name__ == "__main__":
    main()
