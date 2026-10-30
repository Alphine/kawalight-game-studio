"""Space-shooter adapter: wave director, pooled weapon, drift/sine/dive foes."""

from __future__ import annotations

from .base import main_tscn, scene_text

GENRE = "space-shooter"
REQUIRED_SECTIONS = (
    "world", "player", "weapon", "enemies", "waves",
    "scoring", "difficulty", "controls", "victory",
)
CONTROL_ACTIONS = {
    "up": "move_up", "down": "move_down", "left": "move_left",
    "right": "move_right", "fire": "fire", "pause": "pause",
}
HINT = "Move WASD/arrows - Fire SPACE - Pause P"


def validate(config: dict) -> list[str]:
    errors = []
    if not isinstance(config.get("enemies"), list) or not config["enemies"]:
        errors.append("space-shooter config needs a non-empty 'enemies' list")
    if not isinstance(config.get("waves"), list) or not config["waves"]:
        errors.append("space-shooter config needs a non-empty 'waves' list")
    else:
        after = config.get("victory", {}).get("afterWave", 0)
        if isinstance(after, int) and after > len(config["waves"]):
            errors.append(
                f"victory.afterWave ({after}) exceeds wave count"
                f" ({len(config['waves'])})"
            )
    return errors


def _sprite(config: dict, role: str, default: str) -> str:
    try:
        return str(config["assets"]["sprites"][role])
    except (KeyError, TypeError):
        return default


def generate(ctx: dict) -> dict[str, str | bytes]:
    config = ctx["config"]
    radius = float(config["player"].get("radius", 12))
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
                '[sub_resource type="CircleShape2D" id="CircleShape2D_1"]',
                f"radius = {radius}",
            ],
            nodes=[
                '[node name="Player" type="CharacterBody2D"'
                ' groups=["player"]]',
                "motion_mode = 1",
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
        "scenes/enemy.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/enemy.gd" id="1"]',
            ],
            sub_resources=[
                '[sub_resource type="CircleShape2D" id="CircleShape2D_1"]',
                "radius = 14.0",
            ],
            nodes=[
                '[node name="Enemy" type="Area2D" groups=["enemy"]]',
                'script = ExtResource("1")',
                "",
                '[node name="Sprite2D" type="Sprite2D" parent="."]',
                "",
                '[node name="CollisionShape2D" type="CollisionShape2D"'
                ' parent="."]',
                'shape = SubResource("CircleShape2D_1")',
                "",
            ],
        ),
        "scenes/shot.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/shot.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "shot", "assets/shot.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="RectangleShape2D"'
                ' id="RectangleShape2D_1"]',
                "size = Vector2(12, 6)",
            ],
            nodes=[
                '[node name="Shot" type="Area2D" groups=["player_shot"]]',
                "visible = false",
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
        "scenes/pickup.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/pickup.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "pickup", "assets/pickup.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="CircleShape2D" id="CircleShape2D_1"]',
                "radius = 10.0",
            ],
            nodes=[
                '[node name="Pickup" type="Area2D" groups=["pickup"]]',
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
        "scripts/enemy.gd": _enemy_gd(),
        "scripts/shot.gd": _shot_gd(),
        "scripts/pickup.gd": _pickup_gd(),
    }


def _main_gd() -> str:
    return '''extends Node2D
## Space-shooter director: wave spawns, scoring, lives, pause/restart.

const EnemyScene = preload("res://scenes/enemy.tscn")
const PickupScene = preload("res://scenes/pickup.tscn")

var waves: Array = []
var enemy_stats: Dictionary = {}
var wave_index: int = -1
var spawn_queue: Array = []
var spawn_timer: float = 0.0
var inter_wave_timer: float = 0.0
var score: int = 0
var lives: int = 3
var state: String = "playing"
var kill_multiplier: float = 1.0
var wave_clear_bonus: int = 250
var drop_chance: float = 0.0
var powerup_bonus: int = 0
var victory_after_wave: int = 1
var rng = RandomNumberGenerator.new()

@onready var player = $Player
@onready var hud = $HUD


func _ready() -> void:
	get_tree().paused = false
	rng.seed = GameConfig.seed_value
	var player_cfg: Dictionary = GameConfig.section("player")
	lives = int(player_cfg.get("lives", 3))
	var scoring: Dictionary = GameConfig.section("scoring")
	kill_multiplier = float(scoring.get("killMultiplier", 1.0))
	wave_clear_bonus = int(scoring.get("waveClearBonus", 0))
	var pickups: Dictionary = GameConfig.section("pickups")
	drop_chance = float(pickups.get("dropChance", 0.0))
	powerup_bonus = int(pickups.get("powerupBonus", 0))
	victory_after_wave = int(GameConfig.section("victory").get("afterWave", 1))
	for e in GameConfig.data.get("enemies", []):
		enemy_stats[str(e.get("id", ""))] = e
	waves = GameConfig.data.get("waves", [])
	player.setup(player_cfg, GameConfig.section("weapon"))
	player.died.connect(_on_player_died)
	hud.set_hint("Move WASD/arrows - Fire SPACE - Pause P")
	_update_hud()
	_next_wave()


func _process(delta: float) -> void:
	if Input.is_action_just_pressed("pause") and (state == "playing" or get_tree().paused):
		_toggle_pause()
		return
	if get_tree().paused:
		return
	if state == "game_over" or state == "victory":
		if Input.is_action_just_pressed("fire"):
			get_tree().paused = false
			get_tree().reload_current_scene()
		return
	if state != "playing":
		return
	if inter_wave_timer > 0.0:
		inter_wave_timer -= delta
		return
	_tick_spawner(delta)
	_check_wave_clear()


func _tick_spawner(delta: float) -> void:
	if spawn_queue.is_empty():
		return
	spawn_timer -= delta
	if spawn_timer > 0.0:
		return
	var job = spawn_queue.pop_front()
	_spawn_enemy(str(job.get("enemy_id", "")))
	spawn_timer = float(job.get("delay", 0.5))


func _next_wave() -> void:
	state = "playing"
	wave_index += 1
	if wave_index >= waves.size() or wave_index + 1 > victory_after_wave:
		_win()
		return
	var wave = waves[wave_index]
	spawn_queue.clear()
	for s in wave.get("spawns", []):
		var count = int(s.get("count", 1))
		var interval = float(s.get("intervalMs", 800)) / 1000.0
		for i in count:
			spawn_queue.append({"enemy_id": str(s.get("enemyId", "")), "delay": interval})
	inter_wave_timer = float(wave.get("delayAfterPrevMs", 1500)) / 1000.0
	spawn_timer = 0.0
	_update_hud()


func _spawn_enemy(enemy_id: String) -> void:
	if not enemy_stats.has(enemy_id):
		push_warning("space-shooter: unknown enemy id: " + enemy_id)
		return
	var diff: Dictionary = GameConfig.section("difficulty")
	var hp_scale = 1.0 + float(diff.get("enemyHealthScalePerWave", 0.0)) * float(wave_index)
	var sp_scale = 1.0 + float(diff.get("enemySpeedScalePerWave", 0.0)) * float(wave_index)
	var size = GameConfig.world_size()
	var e = EnemyScene.instantiate()
	add_child(e)
	e.position = Vector2(size.x + 40.0, rng.randf_range(40.0, size.y - 40.0))
	e.setup(enemy_stats[enemy_id], hp_scale, sp_scale)
	e.killed.connect(_on_enemy_killed)


func _check_wave_clear() -> void:
	if not spawn_queue.is_empty():
		return
	var foes: Array = get_tree().get_nodes_in_group("enemy")
	if foes.size() > 0:
		return
	state = "intermission"
	score += wave_clear_bonus
	_update_hud()
	hud.show_message("Wave %d clear! +%d" % [wave_index + 1, wave_clear_bonus])
	await get_tree().create_timer(1.2).timeout
	if state != "intermission":
		return
	hud.hide_message()
	_next_wave()


func _on_enemy_killed(value: int, pos: Vector2) -> void:
	score += int(float(value) * kill_multiplier)
	if rng.randf() < drop_chance:
		var p = PickupScene.instantiate()
		add_child(p)
		p.position = pos
		p.setup(powerup_bonus)
		p.collected.connect(_on_pickup)
	_update_hud()


func _on_pickup(bonus: int) -> void:
	score += bonus
	player.power_up()
	_update_hud()


func _on_player_died() -> void:
	lives -= 1
	if lives <= 0:
		state = "game_over"
		player.controls_enabled = false
		hud.show_message("Game over - score %d. Press fire to retry." % score)
	else:
		player.respawn()
	_update_hud()


func _win() -> void:
	state = "victory"
	player.controls_enabled = false
	hud.show_message("Sector clear! Score %d. Press fire to play again." % score)
	_update_hud()


func _update_hud() -> void:
	hud.set_score("Score %d" % score)
	hud.set_status("Wave %d/%d - Lives %d" % [mini(wave_index + 1, waves.size()), waves.size(), lives])


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
## Player starfighter: clamped 8-way movement, pooled weapon, i-frames.

signal died

const ShotScene = preload("res://scenes/shot.tscn")

var speed: float = 320.0
var bounds = Rect2(8.0, 8.0, 568.0, 524.0)
var cooldown: float = 0.18
var projectile_speed: float = 520.0
var damage: int = 1
var max_power: int = 1
var power_level: int = 1
var cooldown_left: float = 0.0
var invuln_left: float = 0.0
var invuln_time: float = 1.2
var alive: bool = true
var controls_enabled: bool = true
var spawn_pos = Vector2.ZERO
var pool: Array = []

@onready var sprite: Sprite2D = $Sprite2D


func setup(player_cfg: Dictionary, weapon: Dictionary) -> void:
	speed = float(player_cfg.get("speed", 320.0))
	spawn_pos = Vector2(float(player_cfg.get("x", 96.0)), float(player_cfg.get("y", 270.0)))
	position = spawn_pos
	var b: Dictionary = player_cfg.get("bounds", {})
	var min_x = float(b.get("minX", 8.0))
	var min_y = float(b.get("minY", 8.0))
	bounds = Rect2(min_x, min_y, float(b.get("maxX", 900.0)) - min_x, float(b.get("maxY", 500.0)) - min_y)
	invuln_time = float(player_cfg.get("invulnerableMs", 1200)) / 1000.0
	cooldown = float(weapon.get("cooldownMs", 180)) / 1000.0
	projectile_speed = float(weapon.get("projectileSpeed", 520.0))
	damage = int(weapon.get("damage", 1))
	max_power = maxi(1, int(weapon.get("powerupLevels", 1)))
	var pool_size = int(weapon.get("poolSize", 32))
	for i in pool_size:
		var s = ShotScene.instantiate()
		get_parent().add_child(s)
		pool.append(s)


func _physics_process(delta: float) -> void:
	if not alive or not controls_enabled:
		return
	var dir = Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = dir * speed
	move_and_slide()
	position.x = clampf(position.x, bounds.position.x, bounds.position.x + bounds.size.x)
	position.y = clampf(position.y, bounds.position.y, bounds.position.y + bounds.size.y)
	cooldown_left = maxf(0.0, cooldown_left - delta)
	if invuln_left > 0.0:
		invuln_left -= delta
		sprite.modulate.a = 0.35 + 0.65 * absf(sin(float(Time.get_ticks_msec()) / 60.0))
		if invuln_left <= 0.0:
			sprite.modulate.a = 1.0
	if Input.is_action_pressed("fire") and cooldown_left <= 0.0:
		_fire()


func _fire() -> void:
	var offsets: Array = [0.0]
	if power_level >= 2:
		offsets = [-10.0, 10.0]
	if power_level >= 3:
		offsets = [-12.0, 0.0, 12.0]
	var fired = false
	for off in offsets:
		var s = _take_shot()
		if s == null:
			break
		s.activate(Vector2(position.x + 14.0, position.y + float(off)), damage, projectile_speed)
		fired = true
	if fired:
		cooldown_left = cooldown


func _take_shot():
	for s in pool:
		if not s.active:
			return s
	return null


func take_hit() -> void:
	if not alive or invuln_left > 0.0:
		return
	alive = false
	visible = false
	died.emit()


func respawn() -> void:
	position = spawn_pos
	alive = true
	visible = true
	invuln_left = invuln_time
	cooldown_left = 0.0


func power_up() -> void:
	power_level = mini(power_level + 1, max_power)
'''


def _enemy_gd() -> str:
    return '''extends Area2D
## Config-driven foe: drift / sine / dive movement, contact damage.

signal killed(score_value: int, pos: Vector2)

var enemy_id: String = ""
var health: int = 1
var speed: float = 90.0
var damage: int = 1
var score_value: int = 100
var behavior: String = "drift"
var amplitude: float = 0.0
var frequency: float = 0.0
var age: float = 0.0
var base_y: float = 0.0
var dive_y: float = 0.0

@onready var sprite: Sprite2D = $Sprite2D
@onready var col: CollisionShape2D = $CollisionShape2D


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func setup(stats: Dictionary, hp_scale: float, sp_scale: float) -> void:
	enemy_id = str(stats.get("id", "foe"))
	health = maxi(1, int(float(stats.get("health", 1)) * hp_scale))
	speed = float(stats.get("speed", 90.0)) * sp_scale
	damage = int(stats.get("damage", 1))
	score_value = int(stats.get("score", 0))
	var behavior_cfg: Dictionary = stats.get("behavior", {})
	behavior = str(behavior_cfg.get("type", "drift"))
	amplitude = float(behavior_cfg.get("amplitude", 0.0))
	frequency = float(behavior_cfg.get("frequencyHz", 0.0))
	var tex_path = GameConfig.sprite_path(str(stats.get("sprite", "")))
	if tex_path != "" and ResourceLoader.exists(tex_path):
		sprite.texture = load(tex_path)
	var circle = CircleShape2D.new()
	circle.radius = float(stats.get("radius", 14.0))
	col.shape = circle
	base_y = position.y
	var heroes: Array = get_tree().get_nodes_in_group("player")
	if heroes.size() > 0:
		dive_y = heroes[0].position.y
	else:
		dive_y = base_y


func _process(delta: float) -> void:
	age += delta
	match behavior:
		"sine":
			position.x -= speed * delta
			position.y = base_y + sin(age * frequency * TAU) * amplitude
		"dive":
			position.x -= speed * 1.5 * delta
			position.y = lerpf(position.y, dive_y, minf(1.0, 2.5 * delta))
		_:
			position.x -= speed * delta
	if position.x < -60.0:
		queue_free()


func take_hit(amount: int) -> void:
	health -= amount
	if health <= 0:
		killed.emit(score_value, position)
		queue_free()
	else:
		sprite.modulate = Color(1.6, 1.6, 1.6)
		var tween = create_tween()
		tween.tween_property(sprite, "modulate", Color.WHITE, 0.08)


func _on_body_entered(body: Node2D) -> void:
	var target = body
	if target.is_in_group("player") and target.has_method("take_hit"):
		target.take_hit()
		take_hit(999)
'''


def _shot_gd() -> str:
    return '''extends Area2D
## Pooled player projectile: flies right, despawns off-screen or on hit.

var damage: int = 1
var speed: float = 520.0
var active: bool = false


func _ready() -> void:
	area_entered.connect(_on_area_entered)
	deactivate()


func activate(from: Vector2, p_damage: int, p_speed: float) -> void:
	position = from
	damage = p_damage
	speed = p_speed
	active = true
	visible = true
	set_process(true)
	set_deferred("monitoring", true)


func deactivate() -> void:
	active = false
	visible = false
	set_process(false)
	set_deferred("monitoring", false)


func _process(delta: float) -> void:
	position.x += speed * delta
	if position.x > GameConfig.world_size().x + 40.0:
		deactivate()


func _on_area_entered(area: Area2D) -> void:
	if not active:
		return
	var target = area
	if target.is_in_group("enemy") and target.has_method("take_hit"):
		target.take_hit(damage)
		deactivate()
'''


def _pickup_gd() -> str:
    return '''extends Area2D
## Power pickup: drifts left, grants score bonus + weapon power on collect.

signal collected(bonus: int)

var bonus: int = 0
var speed: float = 120.0


func setup(powerup_bonus: int) -> void:
	bonus = powerup_bonus


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	position.x -= speed * delta
	if position.x < -40.0:
		queue_free()


func _on_body_entered(body: Node2D) -> void:
	var target = body
	if target.is_in_group("player"):
		collected.emit(bonus)
		queue_free()
'''
