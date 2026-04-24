export function runGammaWallEngine({ spot, flip_level, call_wall, put_wall, max_pain }) {
  let wall_position = 'between_walls';
  if (spot >= call_wall) {
    wall_position = 'above_call_wall';
  } else if (spot <= put_wall) {
    wall_position = 'below_put_wall';
  } else if (spot < flip_level) {
    wall_position = 'below_flip';
  } else if (spot > flip_level) {
    wall_position = 'above_flip';
  }

  let wall_bias = 'neutral';
  if (spot > flip_level && spot >= max_pain) {
    wall_bias = 'bullish';
  } else if (spot < flip_level && spot <= max_pain) {
    wall_bias = 'bearish';
  }

  return {
    wall_position,
    distance_to_flip: Math.round(spot - flip_level),
    distance_to_call_wall: Math.round(call_wall - spot),
    distance_to_put_wall: Math.round(spot - put_wall),
    wall_bias
  };
}
