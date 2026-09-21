/* [Dimensions] */
// Width of the box (mm)
width = 60; // [20:200]
// Depth of the box (mm)
depth = 40; // [20:200]
// Height of the box (mm)
height = 30; // [10:150]
// Wall thickness (mm)
wall = 2; // [1:0.5:6]

/* [Options] */
// Add a flat lid next to the box
with_lid = false;
// Corner style
corner_style = "sharp"; // [sharp:Sharp, rounded:Rounded]

/* [Hidden] */
$fn = 48;

module rounded_rect(size, r) {
    if (r <= 0) {
        square([size[0], size[1]]);
    } else {
        hull() {
            for (x = [r, size[0] - r])
                for (y = [r, size[1] - r])
                    translate([x, y]) circle(r = r);
        }
    }
}

module box() {
    r = corner_style == "rounded" ? min(8, wall * 2 + 2) : 0;
    difference() {
        linear_extrude(height = height)
            rounded_rect([width, depth], r);
        translate([wall, wall, wall])
            linear_extrude(height = height)
                rounded_rect([width - wall * 2, depth - wall * 2], max(r - wall, 0));
    }
}

box();

if (with_lid) {
    translate([0, depth + 10, 0])
        linear_extrude(height = wall)
            square([width, depth]);
}
