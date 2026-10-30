"""Farming adapter: plot grid, water-per-stage crops, day cycle, coin goal."""

from __future__ import annotations

from .base import main_tscn, scene_text

GENRE = "farming"
REQUIRED_SECTIONS = (
    "world", "farm", "crops", "scoring", "difficulty", "controls",
)
CONTROL_ACTIONS = {
    "toolPlant": "tool_plant", "toolWater": "tool_water",
    "toolHarvest": "tool_harvest", "nextDay": "next_day",
    "pause": "pause",
}
HINT = "Tools 1/2/3 - Click a plot - Next day N - Pause P"


def validate(config: dict) -> list[str]:
    errors = []
    if not isinstance(config.get("crops"), list) or not config["crops"]:
        errors.append("farming config needs a non-empty 'crops' list")
    farm = config.get("farm")
    if not isinstance(farm, dict):
        errors.append("farming config needs a 'farm' object")
    else:
        for key in ("cols", "rows", "plotSize", "originX", "originY",
                    "dayLengthSec"):
            if key not in farm:
                errors.append(f"farming farm needs '{key}'")
    return errors


def generate(ctx: dict) -> dict[str, str | bytes]:
    return {
        "scenes/main.tscn": main_tscn(
            instances=[("FarmGrid", "res://scenes/farm_grid.tscn"),
                       ("HUD", "res://scenes/hud.tscn")]
        ),
        "scenes/farm_grid.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/farm_grid.gd" id="1"]',
            ],
            sub_resources=[],
            nodes=[
                '[node name="FarmGrid" type="Node2D"]',
                'script = ExtResource("1")',
                "",
            ],
        ),
        "scripts/main.gd": _main_gd(),
        "scripts/farm_grid.gd": _farm_grid_gd(),
        "scripts/plot.gd": _plot_gd(),
    }


def _main_gd() -> str:
    return '''extends Node2D
## Farming director: coins, day timer, tool selection, win at the goal.

var coins: int = 50
var banked: int = 0
var target_coins: int = 500
var day: int = 1
var day_length: float = 60.0
var day_left: float = 60.0
var tool: String = "plant"
var crop_index: int = 0
var crops: Array = []
var state: String = "playing"

@onready var grid = $FarmGrid
@onready var hud = $HUD


func _ready() -> void:
	get_tree().paused = false
	var scoring: Dictionary = GameConfig.section("scoring")
	coins = int(scoring.get("startCoins", 50))
	banked = 0
	target_coins = int(scoring.get("targetCoins", 500))
	var farm: Dictionary = GameConfig.section("farm")
	day_length = float(farm.get("dayLengthSec", 60.0))
	day_left = day_length
	crops = GameConfig.data.get("crops", [])
	grid.setup(farm, crops)
	grid.plot_clicked.connect(_on_plot_clicked)
	hud.set_hint("Tools 1 plant / 2 water / 3 harvest - Wheel cycles crop - Click a plot - N next day - P pause")
	_update_hud()


func _process(delta: float) -> void:
	if Input.is_action_just_pressed("pause") and (state == "playing" or get_tree().paused):
		_toggle_pause()
		return
	if get_tree().paused:
		return
	if state == "goal":
		if Input.is_action_just_pressed("tool_harvest"):
			get_tree().paused = false
			get_tree().reload_current_scene()
		return
	if Input.is_action_just_pressed("tool_plant"):
		tool = "plant"
	elif Input.is_action_just_pressed("tool_water"):
		tool = "water"
	elif Input.is_action_just_pressed("tool_harvest"):
		tool = "harvest"
	if Input.is_action_just_pressed("next_day"):
		_advance_day()
	day_left -= delta
	if day_left <= 0.0:
		_advance_day()
	_update_hud()


func _unhandled_input(event: InputEvent) -> void:
	if crops.size() < 2:
		return
	var mb = event as InputEventMouseButton
	if mb == null or not mb.pressed:
		return
	if mb.button_index == MOUSE_BUTTON_WHEEL_UP:
		crop_index = (crop_index + 1) % crops.size()
	elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		crop_index = (crop_index + crops.size() - 1) % crops.size()


func _selected_crop() -> Dictionary:
	if crops.is_empty():
		return {}
	return crops[crop_index % crops.size()]


func _on_plot_clicked(plot) -> void:
	if state != "playing":
		return
	if tool == "plant":
		var crop = _selected_crop()
		if crop.is_empty() or not plot.is_empty():
			return
		var cost = int(crop.get("seedCost", 0))
		if coins < cost:
			hud.show_message("Need %d coins for %s seeds (have %d)." % [cost, str(crop.get("name", "crop")), coins])
			var tween = create_tween()
			tween.tween_interval(1.2)
			tween.tween_callback(hud.hide_message)
			return
		coins -= cost
		plot.plant(crop)
	elif tool == "water":
		plot.water()
	elif tool == "harvest":
		var payout = plot.harvest()
		if payout > 0:
			coins += payout
			banked += payout
			if banked >= target_coins:
				_win()
	_update_hud()


func _advance_day() -> void:
	day += 1
	day_left = day_length
	grid.on_new_day()
	hud.set_status("Day %d - plots keep growing; water each stage" % day)


func _win() -> void:
	state = "goal"
	var best = GameConfig.load_best("farm_banked", 0)
	if banked > best:
		best = banked
		GameConfig.save_best("farm_banked", best)
	hud.show_message("Goal banked! %d coins on day %d. Best %d. Press 3 to keep playing." % [banked, day, best])


func _update_hud() -> void:
	var crop = _selected_crop()
	var crop_name = str(crop.get("name", "-")) if not crop.is_empty() else "-"
	hud.set_score("Coins %d (banked %d / %d)" % [coins, banked, target_coins])
	if state == "playing":
		hud.set_status("Day %d - %ds left - Tool: %s (%s)" % [day, int(day_left), tool, crop_name])


func _toggle_pause() -> void:
	var p = not get_tree().paused
	get_tree().paused = p
	if p:
		hud.show_message("Paused - press P to resume")
	else:
		hud.hide_message()
'''


def _farm_grid_gd() -> str:
    return '''extends Node2D
## Plot grid: builds plots from the farm table, routes mouse clicks.

signal plot_clicked(plot)

const PlotScript = preload("res://scripts/plot.gd")

var cols: int = 6
var rows: int = 4
var plot_size: float = 96.0
var origin = Vector2.ZERO
var plots: Array = []


func setup(farm: Dictionary, crops: Array) -> void:
	cols = int(farm.get("cols", 6))
	rows = int(farm.get("rows", 4))
	plot_size = float(farm.get("plotSize", 96.0))
	origin = Vector2(float(farm.get("originX", 0.0)), float(farm.get("originY", 0.0)))
	for r in rows:
		for c in cols:
			var plot = Node2D.new()
			plot.set_script(PlotScript)
			add_child(plot)
			plot.position = origin + Vector2((float(c) + 0.5) * plot_size, (float(r) + 0.5) * plot_size)
			plot.setup(plot_size)
			plots.append(plot)


func on_new_day() -> void:
	pass


func _unhandled_input(event: InputEvent) -> void:
	var mb = event as InputEventMouseButton
	if mb == null or not mb.pressed or mb.button_index != MOUSE_BUTTON_LEFT:
		return
	var local = get_global_mouse_position() - origin
	var c = int(floor(local.x / plot_size))
	var r = int(floor(local.y / plot_size))
	if c < 0 or r < 0 or c >= cols or r >= rows:
		return
	plot_clicked.emit(plots[r * cols + c])
'''


def _plot_gd() -> str:
    return '''extends Node2D
## One farm plot: empty -> planted -> watered -> grows per stage -> ripe.

var plot_size: float = 96.0
var crop: Dictionary = {}
var stage: int = 0
var stages: int = 0
var stage_time: float = 10.0
var stage_left: float = 0.0
var watered: bool = false
var ripe: bool = false
var soil: Sprite2D
var sprout: Sprite2D
var badge: Label


func setup(p_size: float) -> void:
	plot_size = p_size
	soil = Sprite2D.new()
	add_child(soil)
	var soil_path = GameConfig.sprite_path("soil")
	if soil_path != "" and ResourceLoader.exists(soil_path):
		soil.texture = load(soil_path)
	sprout = Sprite2D.new()
	add_child(sprout)
	sprout.visible = false
	badge = Label.new()
	badge.text = ""
	add_child(badge)
	badge.position = Vector2(-plot_size / 2.0 + 4.0, -plot_size / 2.0)


func is_empty() -> bool:
	return crop.is_empty()


func plant(crop_cfg: Dictionary) -> void:
	if not is_empty():
		return
	crop = crop_cfg
	stages = int(crop.get("stages", 1))
	stage = 0
	stage_time = float(crop.get("stageTimeSec", 10.0))
	stage_left = stage_time
	watered = false
	ripe = false
	var tex_path = GameConfig.sprite_path(str(crop.get("sprite", "")))
	if tex_path != "" and ResourceLoader.exists(tex_path):
		sprout.texture = load(tex_path)
	sprout.visible = true
	_refresh()


func water() -> void:
	if is_empty() or ripe or watered:
		return
	watered = true
	_refresh()


func harvest() -> int:
	if is_empty() or not ripe:
		return 0
	var payout = int(crop.get("sellPrice", 0))
	crop = {}
	stage = 0
	ripe = false
	watered = false
	sprout.visible = false
	_refresh()
	return payout


func _process(delta: float) -> void:
	if is_empty() or ripe or not watered:
		return
	stage_left -= delta
	if stage_left > 0.0:
		return
	stage += 1
	if stage >= stages - 1:
		stage = stages - 1
		ripe = true
		watered = false
	else:
		watered = false
		stage_left = stage_time
	_refresh()


func _refresh() -> void:
	if is_empty():
		soil.modulate = Color.WHITE
		badge.text = ""
		return
	soil.modulate = Color(0.6, 0.75, 1.0) if watered else Color(1.0, 0.92, 0.78)
	var frac = 1.0
	if stages > 1:
		frac = float(stage) / float(stages - 1)
	var s = 0.35 + 0.65 * frac
	sprout.scale = Vector2(s, s)
	if ripe:
		badge.text = "$"
	elif not watered:
		badge.text = "!"
	else:
		badge.text = ""
'''
