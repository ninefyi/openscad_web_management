/* [Text] */
// The text to put on the keychain
text_value = "MAKE";
// Text height (mm)
font_size = 10; // [5:24]

/* [Shape] */
// Plate width (mm)
plate_width = 70; // [30:150]
// Plate height (mm)
plate_height = 20; // [10:60]
// Plate thickness (mm)
plate_thickness = 3; // [1:0.5:8]
// Include a hole for a keyring
with_hole = true;

/* [Hidden] */
$fn = 32;
corner_r = 4;
hole_r = 2.5;
text_inset = plate_thickness / 2;

module plate() {
    difference() {
        hull() {
            for (x = [corner_r, plate_width - corner_r])
                for (y = [corner_r, plate_height - corner_r])
                    translate([x, y, 0]) cylinder(r = corner_r, h = plate_thickness);
        }
        if (with_hole) {
            translate([corner_r + 2, plate_height / 2, -1])
                cylinder(r = hole_r, h = plate_thickness + 2);
        }
    }
}

module engraving() {
    text_x = plate_width / 2 + (with_hole ? (corner_r + 2) / 2 : 0);
    translate([text_x, plate_height / 2, plate_thickness - text_inset])
        linear_extrude(height = text_inset + 0.4)
            text(text_value, size = font_size, halign = "center", valign = "center");
}

plate();
engraving();
