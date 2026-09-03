/* Acoustics helpers.

   Sabine RT60 (estimation route):
     RT60 = 0.161 * V / A
   where V is room volume (m3) and A is total absorption (m2 sabins),
   A = sum over surfaces of (surface area * absorption coefficient).

   NOTE ON STANDARDS: Sabine/Eyring is a PREDICTION, not a measurement.
   If RT60 is predicted this way, label it "ESTIMATED" and anchor the
   computation to EN 12354-6. Only label it "MEASURED" and cite
   ISO 3382-2 when it comes from an interrupted-noise decay capture. */

export function sabineRt60(volumeM3, totalAbsorptionM2) {
  if (!totalAbsorptionM2 || totalAbsorptionM2 <= 0) return 0;
  return (0.161 * volumeM3) / totalAbsorptionM2;
}

/* Total absorption from a list of { area, nrc } surfaces. */
export function totalAbsorption(surfaces) {
  return surfaces.reduce((sum, s) => sum + Number(s.area) * Number(s.nrc), 0);
}

/* Is RT60 inside the target band? */
export function isQualified(rt60, target) {
  return rt60 >= target.low && rt60 <= target.high;
}

/* Where RT60 sits relative to the band: "below" | "in" | "above". */
export function bandPosition(rt60, target) {
  if (rt60 < target.low) return "below";
  if (rt60 > target.high) return "above";
  return "in";
}
