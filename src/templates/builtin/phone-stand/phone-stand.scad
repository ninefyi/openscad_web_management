/* [Fit] */
// Thickness of the phone + case (mm)
phone_thickness = 12; // [6:25]
// Width of the slot (mm)
slot_width = 80; // [50:120]

/* [Shape] */
// Viewing angle (degrees from vertical)
angle = 60; // [40:80]
// Base depth (mm)
base_depth = 90; // [60:140]
// Overall height (mm)
stand_height = 100; // [60:150]
// Material thickness (mm)
wall = 6; // [3:1:12]

/* [Hidden] */
$fn = 32;
slot_depth = phone_thickness + wall * 2;

module base() {
    linear_extrude(height = wall)
        square([slot_width + wall * 2, base_depth]);
}

module back_support() {
    rotate([90 - angle, 0, 0])
        translate([0, 0, -wall])
            linear_extrude(height = wall)
                square([slot_width + wall * 2, stand_height]);
}

module lip() {
    translate([0, slot_depth, 0])
        rotate([90 - angle, 0, 0])
            cube([slot_width + wall * 2, wall, wall * 2]);
}

base();
translate([0, base_depth - slot_depth, wall])
    back_support();
translate([0, base_depth - slot_depth, wall])
    lip();
