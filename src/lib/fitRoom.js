/* Derive the room rectangle from four cardinal LiDAR rays.
   LD06 measures N, S, E, W from a centre point:
     length = N + S   (the axis running north-south)
     width  = E + W   (the axis running east-west)
   Height comes from the ultrasonic ceiling sensor.

   Conversion happens here, at the edge: metres to 2 dp,
   area in m2, volume in m3. */

export function fitRoom(cardinal) {
  const width = round2(Number(cardinal.E || 0) + Number(cardinal.W || 0));
  const length = round2(Number(cardinal.N || 0) + Number(cardinal.S || 0));
  const height = round2(Number(cardinal.height || 0));

  return {
    width,
    length,
    height,
    area: round2(width * length),
    volume: round2(width * length * height),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
