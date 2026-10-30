"""Genre adapters: each maps one KGSM genre config to GDScript + scenes."""

from . import battle_2d, endless_runner, farming, side_scroller, space_shooter

GENRES = {
    "space-shooter": space_shooter,
    "endless-runner": endless_runner,
    "side-scroller": side_scroller,
    "battle-2d": battle_2d,
    "farming": farming,
}
