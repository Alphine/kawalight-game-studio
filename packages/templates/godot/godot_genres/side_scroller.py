"""Side-scroller adapter: coyote/buffer platformer, built-from-config level."""

from __future__ import annotations

from .base import main_tscn, scene_text

GENRE = "side-scroller"
REQUIRED_SECTIONS = (
    "world", "player", "level", "scoring", "difficulty", "controls",
)
CONTROL_ACTIONS = {
    "left": "move_left", "right": "move_right",
    "jump": "jump", "pause": "pause",
}
HINT = "Move arrows - Jump SPACE - Pause P"


def validate(config: dict) -> list[str]:
    errors = []
    level = config.get("level")
    if not isinstance(level, dict):
        return ["side-scroller config needs a 'level' object"]
    if not isinstance(level.get("platforms"), list) or not level["platforms"]:
        errors.append("side-scroller level needs a non-empty 'platforms' list")
    if not isinstance(level.get("exit"), dict):
        errors.append("side-scroller level needs an 'exit' object")
    return errors


def _sprite(config: dict, role: str, default: str) -> str:
    try:
        return str(config["assets"]["sprites"][role])
    except (KeyError, TypeError):
        return default


def generate(ctx: dict) -> dict[str, str | bytes]:
    config = ctx["config"]
    player = config["player"]
    pw = float(player.get("width", 32))
    ph = float(player.get("height", 44))
    return {
        "scenes/main.tscn": main_tscn(
            instances=[("Player", "res://scenes/player.tscn"),
                       ("Camera", "res://scenes/camera.tscn"),
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
                '[node name="Player" type="CharacterBody2D"'
                ' groups=["player"]]',
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
        "scenes/camera.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/camera.gd" id="1"]',
            ],
            sub_resources=[],
            nodes=[
                '[node name="Camera" type="Camera2D"]',
                'script = ExtResource("1")',
                "",
            ],
        ),
        "scenes/walker.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/walker.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "walker", "assets/walker.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="RectangleShape2D"'
                ' id="RectangleShape2D_1"]',
                "size = Vector2(36, 28)",
            ],
            nodes=[
                '[node name="Walker" type="Area2D" groups=["enemy"]]',
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
        "scenes/spikes.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/spikes.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "spikes", "assets/spikes.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="RectangleShape2D"'
                ' id="RectangleShape2D_1"]',
                "size = Vector2(32, 24)",
            ],
            nodes=[
                '[node name="Spikes" type="Area2D" groups=["hazard"]]',
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
        "scenes/checkpoint.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/checkpoint.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "checkpoint", "assets/checkpoint.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="RectangleShape2D"'
                ' id="RectangleShape2D_1"]',
                "size = Vector2(32, 100)",
            ],
            nodes=[
                '[node name="Checkpoint" type="Area2D" groups=["checkpoint"]]',
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
        "scenes/exit.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/exit.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "exit-door", "assets/exit-door.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="RectangleShape2D"'
                ' id="RectangleShape2D_1"]',
                "size = Vector2(48, 80)",
            ],
            nodes=[
                '[node name="Exit" type="Area2D" groups=["exit"]]',
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
        "scripts/main.gd": _main_gd(),
        "scripts/player.gd": _player_gd(),
        "scripts/camera.gd": _camera_gd(),
        "scripts/walker.gd": _walker_gd(),
        "scripts/spikes.gd": _spikes_gd(),
        "scripts/coin.gd": _coin_gd(),
        "scripts/checkpoint.gd": _checkpoint_gd(),
        "scripts/exit.gd": _exit_gd(),
    }


def _main_gd() -> str:
    return '''extends Node2D
## Side-scroller director: builds the level from config, scores, states.

const WalkerScene = preload("res://scenes/walker.tscn")
const SpikesScene = preload("res://scenes/spikes.tscn")
const CoinScene = preload("res://scenes/coin.tscn")
const CheckpointScene = preload("res://scenes/checkpoint.tscn")
const ExitScene = preload("res://scenes/exit.tscn")

var coin_score: int = 10
var stomp_score: int = 25
var time_bonus_per_sec: int = 5
var par_time_sec: int = 60
var kill_plane_y: float = 600.0
var score: int = 0
var coins: int = 0
var stomps: int = 0
var elapsed: float = 0.0
var state: String = "playing"
var spawn_pos = Vector2.ZERO

@onready var player = $Player
@onready var camera = $Camera
@onready var hud = $HUD


func _ready() -> void:
	get_tree().paused = false
	var scoring: Dictionary = GameConfig.section("scoring")
	coin_score = int(scoring.get("coinScore", 10))
	stomp_score = int(scoring.get("stompScore", 25))
	time_bonus_per_sec = int(scoring.get("timeBonusPerSec", 5))
	par_time_sec = int(scoring.get("parTimeSec", 60))
	kill_plane_y = float(GameConfig.section("world").get("killPlaneY", 600.0))
	_build_level(GameConfig.section("level"))
	player.setup(GameConfig.section("player"))
	spawn_pos = player.position
	player.died.connect(_on_player_died)
	player.stomped.connect(_on_stomp)
	camera.follow(player, GameConfig.section("camera"))
	hud.set_hint("Move arrows - Jump SPACE - Pause P")
	_update_hud()


func _process(delta: float) -> void:
	if Input.is_action_just_pressed("pause") and (state == "playing" or get_tree().paused):
		_toggle_pause()
		return
	if get_tree().paused:
		return
	if state == "game_over" or state == "victory":
		if Input.is_action_just_pressed("jump"):
			get_tree().paused = false
			get_tree().reload_current_scene()
		return
	elapsed += delta
	if player.position.y > kill_plane_y:
		player.take_hit(99, player.position.x)
	_update_hud()


func _build_level(level: Dictionary) -> void:
	var solids = Node2D.new()
	solids.name = "Solids"
	add_child(solids)
	for p in level.get("platforms", []):
		_add_platform(solids, p)
	for h in level.get("hazards", []):
		var s = SpikesScene.instantiate()
		add_child(s)
		s.setup(h)
	for e in level.get("enemies", []):
		var w = WalkerScene.instantiate()
		add_child(w)
		w.setup(e)
		w.squashed.connect(_on_walker_squashed.bind(w))
	for c in level.get("collectibles", []):
		var coin = CoinScene.instantiate()
		add_child(coin)
		coin.position = Vector2(float(c.get("x", 0.0)), float(c.get("y", 0.0)))
		coin.setup(coin_score)
		coin.collected.connect(_on_coin)
	for cp in level.get("checkpoints", []):
		var check = CheckpointScene.instantiate()
		add_child(check)
		check.setup(cp)
		check.touched.connect(_on_checkpoint.bind(check))
	var exit_cfg: Dictionary = level.get("exit", {})
	var door = ExitScene.instantiate()
	add_child(door)
	door.setup(exit_cfg)
	door.touched.connect(_on_exit)


func _add_platform(parent: Node, p) -> void:
	var x = float(p.get("x", 0.0))
	var y = float(p.get("y", 0.0))
	var w = float(p.get("w", 64.0))
	var h = float(p.get("h", 16.0))
	var body = StaticBody2D.new()
	body.position = Vector2(x + w / 2.0, y + h / 2.0)
	var col = CollisionShape2D.new()
	var rect = RectangleShape2D.new()
	rect.size = Vector2(w, h)
	col.shape = rect
	body.add_child(col)
	var one_way = bool(p.get("oneWay", false))
	col.one_way_collision = one_way
	var poly = Polygon2D.new()
	poly.color = Color(0.55, 0.38, 0.22) if one_way else Color(0.35, 0.30, 0.28)
	poly.polygon = PackedVector2Array([Vector2(-w / 2, -h / 2), Vector2(w / 2, -h / 2), Vector2(w / 2, h / 2), Vector2(-w / 2, h / 2)])
	body.add_child(poly)
	parent.add_child(body)


func _on_coin(value: int) -> void:
	coins += 1
	score += value
	_update_hud()


func _on_stomp() -> void:
	stomps += 1
	score += stomp_score
	_update_hud()


func _on_walker_squashed(_walker) -> void:
	pass


func _on_checkpoint(check) -> void:
	spawn_pos = check.position + Vector2(0, -40)
	player.set_spawn(spawn_pos)
	hud.set_status("Checkpoint! Lives %d" % player.health)


func _on_exit() -> void:
	if state != "playing":
		return
	state = "victory"
	var time_bonus = maxi(0, int((float(par_time_sec) - elapsed)) * time_bonus_per_sec)
	score += time_bonus
	player.controls_enabled = false
	var best = GameConfig.load_best("scroller_score", 0)
	if score > best:
		best = score
		GameConfig.save_best("scroller_score", best)
	hud.show_message("Stage clear! %d pts (%ds, +%d time bonus). Best %d. Press jump." % [score, int(elapsed), time_bonus, best])
	_update_hud()


func _on_player_died() -> void:
	if player.lives_fallen():
		state = "game_over"
		hud.show_message("Game over - %d pts. Press jump to retry." % score)
	else:
		player.respawn()
	_update_hud()


func _update_hud() -> void:
	hud.set_score("%d pts - %d coins - %ds" % [score, coins, int(elapsed)])
	if state == "playing":
		hud.set_status("Health %d" % player.health)


func _toggle_pause() -> void:
	var p = not get_tree().paused
	get_tree().paused = p
	if p:
		hud.show_message("Paused - press P to resume")
	else:
		hud.hide_message()
'''


def _player_gd() -> str:
    return '''extends CharacterBody2D
## Platformer hero: accel, coyote time, jump buffer, stomp, i-frames.

signal died
signal stomped

var move_speed: float = 300.0
var acceleration: float = 2600.0
var air_control: float = 0.65
var jump_velocity: float = 850.0
var gravity: float = 2600.0
var max_fall: float = 1400.0
var coyote: float = 0.1
var jump_buffer: float = 0.12
var max_jumps: int = 1
var health: int = 3
var invuln_time: float = 1.2
var knockback: float = 280.0
var stomp_bounce: float = 560.0
var coyote_left: float = 0.0
var buffer_left: float = 0.0
var jumps_left: int = 1
var invuln_left: float = 0.0
var alive: bool = true
var controls_enabled: bool = true
var spawn_pos = Vector2.ZERO

@onready var sprite: Sprite2D = $Sprite2D


func setup(player_cfg: Dictionary) -> void:
	var world: Dictionary = GameConfig.section("world")
	gravity = float(world.get("gravity", 2600.0))
	max_fall = float(world.get("maxFallSpeed", 1400.0))
	move_speed = float(player_cfg.get("moveSpeed", 300.0))
	acceleration = float(player_cfg.get("acceleration", 2600.0))
	air_control = float(player_cfg.get("airControl", 0.65))
	jump_velocity = float(player_cfg.get("jumpVelocity", 850.0))
	coyote = float(player_cfg.get("coyoteMs", 100)) / 1000.0
	jump_buffer = float(player_cfg.get("jumpBufferMs", 120)) / 1000.0
	max_jumps = int(player_cfg.get("maxJumps", 1))
	health = int(player_cfg.get("health", 3))
	invuln_time = float(player_cfg.get("invulnMs", 1200)) / 1000.0
	knockback = float(player_cfg.get("knockback", 280.0))
	stomp_bounce = float(player_cfg.get("stompBounce", 560.0))
	var spawn: Dictionary = player_cfg.get("spawn", {})
	spawn_pos = Vector2(float(spawn.get("x", 80.0)), float(spawn.get("y", 400.0)))
	position = spawn_pos
	jumps_left = max_jumps


func _physics_process(delta: float) -> void:
	if not alive or not controls_enabled:
		return
	var on_floor = is_on_floor()
	if on_floor:
		coyote_left = coyote
		jumps_left = max_jumps
	else:
		coyote_left = maxf(0.0, coyote_left - delta)
	if Input.is_action_just_pressed("jump"):
		buffer_left = jump_buffer
	else:
		buffer_left = maxf(0.0, buffer_left - delta)
	if buffer_left > 0.0 and (on_floor or coyote_left > 0.0 or jumps_left > 0):
		velocity.y = -jump_velocity
		buffer_left = 0.0
		coyote_left = 0.0
		jumps_left = maxi(0, jumps_left - 1)
	velocity.y = minf(velocity.y + gravity * delta, max_fall)
	var want = Input.get_axis("move_left", "move_right")
	var grip = acceleration * (1.0 if on_floor else air_control)
	velocity.x = move_toward(velocity.x, want * move_speed, grip * delta)
	move_and_slide()
	if want != 0.0:
		sprite.flip_h = want < 0.0
	if invuln_left > 0.0:
		invuln_left -= delta
		sprite.modulate.a = 0.35 + 0.65 * absf(sin(float(Time.get_ticks_msec()) / 60.0))
		if invuln_left <= 0.0:
			sprite.modulate.a = 1.0


func take_hit(amount: int, from_x: float) -> void:
	if not alive or invuln_left > 0.0:
		return
	health -= amount
	invuln_left = invuln_time
	var away = signf(position.x - from_x)
	if away == 0.0:
		away = 1.0
	velocity = Vector2(away * knockback, -knockback * 0.6)
	if health <= 0:
		alive = false
		visible = false
		died.emit()


func bounce() -> void:
	velocity.y = -stomp_bounce
	stomped.emit()


func set_spawn(pos: Vector2) -> void:
	spawn_pos = pos


func lives_fallen() -> bool:
	return health <= 0


func respawn() -> void:
	position = spawn_pos
	velocity = Vector2.ZERO
	alive = true
	visible = true
	invuln_left = invuln_time
'''


def _camera_gd() -> str:
    return '''extends Camera2D
## Deadzone follow camera with lerp, clamped to the level bounds.

var target = null
var follow_lerp: float = 0.12
var deadzone = Vector2(80, 60)
var level_min = Vector2.ZERO
var level_max = Vector2(3200, 540)


func follow(player, camera_cfg: Dictionary) -> void:
	target = player
	follow_lerp = float(camera_cfg.get("followLerp", 0.12))
	deadzone = Vector2(float(camera_cfg.get("deadzoneX", 80.0)), float(camera_cfg.get("deadzoneY", 60.0)))
	var world: Dictionary = GameConfig.section("world")
	level_max = Vector2(float(world.get("levelWidth", 3200.0)), float(world.get("levelHeight", 540.0)))
	make_current()
	_snap()


func _snap() -> void:
	if target == null:
		return
	position = _clamped(target.position)


func _process(_delta: float) -> void:
	if target == null:
		return
	var goal = position
	if absf(target.position.x - position.x) > deadzone.x:
		goal.x = target.position.x - signf(target.position.x - position.x) * deadzone.x
	if absf(target.position.y - position.y) > deadzone.y:
		goal.y = target.position.y - signf(target.position.y - position.y) * deadzone.y
	position = position.lerp(_clamped(goal), clampf(follow_lerp, 0.01, 1.0))


func _clamped(p: Vector2) -> Vector2:
	var half = get_viewport_rect().size / 2.0
	return Vector2(clampf(p.x, half.x, maxf(half.x, level_max.x - half.x)), clampf(p.y, half.y, maxf(half.y, level_max.y - half.y)))
'''


def _walker_gd() -> str:
    return '''extends Area2D
## Patrolling crawler: stomped from above, hurts from the side.

signal squashed

var speed: float = 80.0
var min_x: float = 0.0
var max_x: float = 100.0
var dir: float = 1.0
var dead: bool = false

@onready var sprite: Sprite2D = $Sprite2D


func setup(spec: Dictionary) -> void:
	position = Vector2(float(spec.get("x", 0.0)), float(spec.get("y", 0.0)))
	speed = float(spec.get("speed", 80.0))
	min_x = float(spec.get("patrolMinX", position.x - 100.0))
	max_x = float(spec.get("patrolMaxX", position.x + 100.0))
	var tex_path = GameConfig.sprite_path(str(spec.get("sprite", "walker")))
	if tex_path != "" and ResourceLoader.exists(tex_path):
		sprite.texture = load(tex_path)
	var rect = RectangleShape2D.new()
	rect.size = Vector2(float(spec.get("w", 36.0)), float(spec.get("h", 28.0)))
	($CollisionShape2D as CollisionShape2D).shape = rect


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	if dead:
		return
	position.x += dir * speed * delta
	if position.x < min_x:
		position.x = min_x
		dir = 1.0
	elif position.x > max_x:
		position.x = max_x
		dir = -1.0
	sprite.flip_h = dir < 0.0


func _on_body_entered(body: Node2D) -> void:
	if dead:
		return
	var target = body
	if not target.is_in_group("player"):
		return
	# Stomp when the player is falling and above the walker's midpoint.
	if target.velocity.y > 60.0 and target.position.y < position.y - 4.0:
		dead = true
		squashed.emit()
		if target.has_method("bounce"):
			target.bounce()
		queue_free()
	elif target.has_method("take_hit"):
		target.take_hit(1, position.x)
'''


def _spikes_gd() -> str:
    return '''extends Area2D
## Static spike strip: contact damage, positioned from the level table.

func setup(spec: Dictionary) -> void:
	var w = float(spec.get("w", 32.0))
	var h = float(spec.get("h", 24.0))
	position = Vector2(float(spec.get("x", 0.0)) + w / 2.0, float(spec.get("y", 0.0)) + h / 2.0)
	var rect = RectangleShape2D.new()
	rect.size = Vector2(w, h)
	($CollisionShape2D as CollisionShape2D).shape = rect


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node2D) -> void:
	var target = body
	if target.is_in_group("player") and target.has_method("take_hit"):
		target.take_hit(1, position.x)
'''


def _coin_gd() -> str:
    return '''extends Area2D
## Static level coin: collected on player touch.

signal collected(value: int)

var value: int = 10


func setup(coin_score: int) -> void:
	value = coin_score


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node2D) -> void:
	var target = body
	if target.is_in_group("player"):
		collected.emit(value)
		queue_free()
'''


def _checkpoint_gd() -> str:
    return '''extends Area2D
## Checkpoint flag: first touch moves the respawn point here.

signal touched

var claimed: bool = false


func setup(spec: Dictionary) -> void:
	var w = float(spec.get("w", 32.0))
	var h = float(spec.get("h", 100.0))
	position = Vector2(float(spec.get("x", 0.0)) + w / 2.0, float(spec.get("y", 0.0)) + h / 2.0)
	var rect = RectangleShape2D.new()
	rect.size = Vector2(w, h)
	($CollisionShape2D as CollisionShape2D).shape = rect


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node2D) -> void:
	var target = body
	if claimed or not target.is_in_group("player"):
		return
	claimed = true
	touched.emit()
'''


def _exit_gd() -> str:
    return '''extends Area2D
## Exit arch: touching it clears the stage.

signal touched


func setup(spec: Dictionary) -> void:
	var w = float(spec.get("w", 48.0))
	var h = float(spec.get("h", 80.0))
	position = Vector2(float(spec.get("x", 0.0)) + w / 2.0, float(spec.get("y", 0.0)) + h / 2.0)
	var rect = RectangleShape2D.new()
	rect.size = Vector2(w, h)
	($CollisionShape2D as CollisionShape2D).shape = rect


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node2D) -> void:
	var target = body
	if target.is_in_group("player"):
		touched.emit()
'''
