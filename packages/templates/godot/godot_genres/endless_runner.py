"""Endless-runner adapter: auto-scroll, jump/slide, gap-tightening spawner."""

from __future__ import annotations

from .base import main_tscn, scene_text

GENRE = "endless-runner"
REQUIRED_SECTIONS = (
    "world", "player", "spawning", "obstacles",
    "scoring", "difficulty", "controls",
)
CONTROL_ACTIONS = {"jump": "jump", "slide": "slide", "pause": "pause"}
HINT = "Jump SPACE - Slide S - Pause P"


def validate(config: dict) -> list[str]:
    errors = []
    if not isinstance(config.get("obstacles"), list) or not config["obstacles"]:
        errors.append("endless-runner config needs a non-empty 'obstacles' list")
    return errors


def _sprite(config: dict, role: str, default: str) -> str:
    try:
        return str(config["assets"]["sprites"][role])
    except (KeyError, TypeError):
        return default


def generate(ctx: dict) -> dict[str, str | bytes]:
    config = ctx["config"]
    player = config["player"]
    pw = float(player.get("width", 36))
    ph = float(player.get("height", 48))
    return {
        "scenes/main.tscn": main_tscn(
            instances=[("Player", "res://scenes/player.tscn"),
                       ("HUD", "res://scenes/hud.tscn")]
        ),
        "scenes/player.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/player.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "player", "assets/player.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="RectangleShape2D"'
                ' id="RectangleShape2D_1"]',
                f"size = Vector2({pw}, {ph})",
            ],
            nodes=[
                '[node name="Player" type="Area2D" groups=["player"]]',
                'script = ExtResource("1")',
                "",
                '[node name="Sprite2D" type="Sprite2D" parent="."]',
                'texture = ExtResource("2")',
                "",
                '[node name="CollisionShape2D" type="CollisionShape2D"'
                ' parent="."]',
                'shape = SubResource("RectangleShape2D_1")',
                "",
            ],
        ),
        "scenes/obstacle.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/obstacle.gd" id="1"]',
            ],
            sub_resources=[
                '[sub_resource type="RectangleShape2D"'
                ' id="RectangleShape2D_1"]',
                "size = Vector2(30, 40)",
            ],
            nodes=[
                '[node name="Obstacle" type="Area2D" groups=["obstacle"]]',
                'script = ExtResource("1")',
                "",
                '[node name="Sprite2D" type="Sprite2D" parent="."]',
                "",
                '[node name="CollisionShape2D" type="CollisionShape2D"'
                ' parent="."]',
                'shape = SubResource("RectangleShape2D_1")',
                "",
            ],
        ),
        "scenes/coin.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/coin.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "coin", "assets/coin.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="CircleShape2D" id="CircleShape2D_1"]',
                "radius = 10.0",
            ],
            nodes=[
                '[node name="Coin" type="Area2D" groups=["coin"]]',
                'script = ExtResource("1")',
                "",
                '[node name="Sprite2D" type="Sprite2D" parent="."]',
                'texture = ExtResource("2")',
                "",
                '[node name="CollisionShape2D" type="CollisionShape2D"'
                ' parent="."]',
                'shape = SubResource("CircleShape2D_1")',
                "",
            ],
        ),
        "scripts/main.gd": _main_gd(),
        "scripts/player.gd": _player_gd(),
        "scripts/obstacle.gd": _obstacle_gd(),
        "scripts/coin.gd": _coin_gd(),
    }


def _main_gd() -> str:
    return '''extends Node2D
## Endless-runner director: scroll speed ramp, spawner, distance + coins.

const ObstacleScene = preload("res://scenes/obstacle.tscn")
const CoinScene = preload("res://scenes/coin.tscn")

var base_speed: float = 280.0
var max_speed: float = 560.0
var speed_ramp: float = 6.0
var current_speed: float = 280.0
var px_per_meter: float = 50.0
var ground_y: float = 470.0
var start_gap: float = 600.0
var min_gap: float = 480.0
var grace_px: float = 1400.0
var spawn_ahead: float = 80.0
var coin_score: int = 10
var milestone_every_m: int = 100
var obstacles: Array = []
var distance_px: float = 0.0
var coins: int = 0
var score_cache: int = 0
var next_milestone_m: int = 100
var spawn_debt: float = 0.0
var state: String = "playing"
var rng = RandomNumberGenerator.new()

@onready var player = $Player
@onready var hud = $HUD


func _ready() -> void:
	get_tree().paused = false
	rng.seed = GameConfig.seed_value
	var world: Dictionary = GameConfig.section("world")
	base_speed = float(world.get("baseSpeed", 280.0))
	max_speed = float(world.get("maxSpeed", 560.0))
	speed_ramp = float(world.get("speedRampPerSec", 6.0))
	px_per_meter = float(world.get("pxPerMeter", 50.0))
	ground_y = float(world.get("groundY", 470.0))
	current_speed = base_speed
	var spawning: Dictionary = GameConfig.section("spawning")
	grace_px = float(spawning.get("gracePx", 1400.0))
	start_gap = float(spawning.get("startGapPx", 600.0))
	min_gap = float(spawning.get("minGapPx", 480.0))
	spawn_ahead = float(spawning.get("spawnAheadPx", 80.0))
	var scoring: Dictionary = GameConfig.section("scoring")
	coin_score = int(scoring.get("coinScore", 10))
	milestone_every_m = int(scoring.get("milestoneEveryM", 100))
	next_milestone_m = milestone_every_m
	obstacles = GameConfig.data.get("obstacles", [])
	player.setup(GameConfig.section("player"), ground_y)
	player.died.connect(_on_player_died)
	spawn_debt = grace_px
	hud.set_hint("Jump SPACE - Slide S - Pause P")
	_update_hud()


func _process(delta: float) -> void:
	if Input.is_action_just_pressed("pause") and (state == "playing" or get_tree().paused):
		_toggle_pause()
		return
	if get_tree().paused:
		return
	if state == "game_over":
		if Input.is_action_just_pressed("jump"):
			get_tree().paused = false
			get_tree().reload_current_scene()
		return
	current_speed = minf(max_speed, current_speed + speed_ramp * delta)
	distance_px += current_speed * delta
	spawn_debt -= current_speed * delta
	if spawn_debt <= 0.0:
		_spawn_row()
	var meters = int(distance_px / px_per_meter)
	if meters >= next_milestone_m:
		hud.show_message("%dm!" % next_milestone_m)
		next_milestone_m += milestone_every_m
		var tween = create_tween()
		tween.tween_interval(0.9)
		tween.tween_callback(hud.hide_message)
	_update_hud()


func _current_gap() -> float:
	# Gaps tighten from start_gap to min_gap over the first 5000 px.
	var t = clampf(distance_px / 5000.0, 0.0, 1.0)
	return lerpf(start_gap, min_gap, t)


func _spawn_row() -> void:
	var size = GameConfig.world_size()
	var x = size.x + spawn_ahead
	var spec = obstacles[rng.randi_range(0, obstacles.size() - 1)]
	var kind = str(spec.get("kind", "ground"))
	var o = ObstacleScene.instantiate()
	add_child(o)
	var h = float(spec.get("h", 40.0))
	if kind == "high":
		var hover = float(spec.get("hoverH", 30.0))
		o.setup(spec, Vector2(x, ground_y - hover - h / 2.0))
	else:
		o.setup(spec, Vector2(x, ground_y - h / 2.0))
	if rng.randf() < 0.7:
		_spawn_coins(x, kind)
	spawn_debt = _current_gap()


func _spawn_coins(x: float, kind: String) -> void:
	# Coin line on the ground, or an arc over ground obstacles.
	if kind == "high":
		for i in 5:
			_spawn_coin(Vector2(x + float(i) * 28.0, ground_y - 20.0))
	else:
		for i in 5:
			var t = float(i) / 4.0
			_spawn_coin(Vector2(x - 56.0 + t * 112.0, ground_y - 40.0 - sin(t * PI) * 90.0))


func _spawn_coin(pos: Vector2) -> void:
	var c = CoinScene.instantiate()
	add_child(c)
	c.position = pos
	c.setup(coin_score)
	c.collected.connect(_on_coin)


func _on_coin(value: int) -> void:
	coins += 1
	score_cache += value
	_update_hud()


func _meters() -> int:
	return int(distance_px / px_per_meter)


func _on_player_died() -> void:
	state = "game_over"
	var total = _meters() + score_cache
	var best = GameConfig.load_best("endless_distance_m", 0)
	if _meters() > best:
		best = _meters()
		GameConfig.save_best("endless_distance_m", best)
	hud.show_message("Wipeout! %dm + %d coins (%d pts). Best %dm. Press jump." % [_meters(), coins, total, best])
	_update_hud()


func _update_hud() -> void:
	hud.set_score("%dm  -  %d coins (%d pts)" % [_meters(), coins, _meters() + score_cache])
	hud.set_status("Speed %d px/s - Best %dm" % [int(current_speed), GameConfig.load_best("endless_distance_m", 0)])


func _toggle_pause() -> void:
	var p = not get_tree().paused
	get_tree().paused = p
	if p:
		hud.show_message("Paused - press P to resume")
	else:
		hud.hide_message()
'''


def _player_gd() -> str:
    return '''extends Area2D
## Runner: fixed-x jump/slide with gravity, dies on obstacle contact.

signal died

var gravity: float = 3000.0
var jump_velocity: float = 880.0
var ground_y: float = 470.0
var stand_h: float = 48.0
var slide_h: float = 24.0
var vy: float = 0.0
var sliding: bool = false
var alive: bool = true

@onready var sprite: Sprite2D = $Sprite2D
@onready var col: CollisionShape2D = $CollisionShape2D


func setup(player_cfg: Dictionary, p_ground_y: float) -> void:
	ground_y = p_ground_y
	gravity = float(GameConfig.section("world").get("gravity", 3000.0))
	jump_velocity = float(player_cfg.get("jumpVelocity", 880.0))
	stand_h = float(player_cfg.get("height", 48.0))
	slide_h = float(player_cfg.get("slideHeight", 24.0))
	position = Vector2(float(player_cfg.get("x", 180.0)), ground_y - stand_h / 2.0)


func _ready() -> void:
	area_entered.connect(_on_area_entered)
	col.shape = col.shape.duplicate()


func _physics_process(delta: float) -> void:
	if not alive:
		return
	var floor_y = ground_y - _height() / 2.0
	var on_floor = position.y >= floor_y - 0.5
	if on_floor and Input.is_action_just_pressed("jump"):
		vy = -jump_velocity
		_set_slide(false)
	vy += gravity * delta
	position.y = minf(position.y + vy * delta, floor_y)
	if on_floor and vy > 0.0:
		vy = 0.0
	var want_slide = Input.is_action_pressed("slide") and on_floor
	if want_slide != sliding:
		_set_slide(want_slide)


func _height() -> float:
	return slide_h if sliding else stand_h


func _set_slide(value: bool) -> void:
	sliding = value
	var rect = col.shape as RectangleShape2D
	rect.size.y = _height()
	rect.size.x = float(GameConfig.section("player").get("width", 36.0))
	position.y = ground_y - _height() / 2.0
	sprite.scale.y = _height() / stand_h


func _on_area_entered(area: Area2D) -> void:
	if not alive:
		return
	var target = area
	if target.is_in_group("obstacle"):
		alive = false
		died.emit()
'''


def _obstacle_gd() -> str:
    return '''extends Area2D
## Scrolling obstacle: moves left at the director speed, kills on touch.

var dead: bool = false


func setup(spec: Dictionary, pos: Vector2) -> void:
	position = pos
	var tex_path = GameConfig.sprite_path(str(spec.get("sprite", "")))
	if tex_path != "" and ResourceLoader.exists(tex_path):
		($Sprite2D as Sprite2D).texture = load(tex_path)
	var rect = RectangleShape2D.new()
	rect.size = Vector2(float(spec.get("w", 30.0)), float(spec.get("h", 40.0)))
	($CollisionShape2D as CollisionShape2D).shape = rect


func _process(_delta: float) -> void:
	var games: Array = get_tree().get_nodes_in_group("game")
	if games.size() > 0:
		position.x -= float(games[0].current_speed) * _delta
	if position.x < -80.0:
		queue_free()
'''


def _coin_gd() -> str:
    return '''extends Area2D
## Scrolling coin: moves left with the world, collected on player touch.

signal collected(value: int)

var value: int = 10


func setup(coin_score: int) -> void:
	value = coin_score


func _ready() -> void:
	area_entered.connect(_on_area_entered)


func _process(delta: float) -> void:
	var games: Array = get_tree().get_nodes_in_group("game")
	if games.size() > 0:
		position.x -= float(games[0].current_speed) * delta
	if position.x < -60.0:
		queue_free()


func _on_area_entered(area: Area2D) -> void:
	var target = area
	if target.is_in_group("player"):
		collected.emit(value)
		queue_free()
'''
