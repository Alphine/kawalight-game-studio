"""Battle-2d adapter: arena waves, auto-aim bolts, melee, chaser/weaver/shooter."""

from __future__ import annotations

from .base import main_tscn, scene_text

GENRE = "battle-2d"
REQUIRED_SECTIONS = (
    "world", "player", "melee", "ranged", "enemies", "waves",
    "scoring", "difficulty", "controls", "victory",
)
CONTROL_ACTIONS = {
    "up": "move_up", "down": "move_down", "left": "move_left",
    "right": "move_right", "fire": "fire", "melee": "melee",
    "pause": "pause",
}
HINT = "Move WASD - Fire SPACE (auto-aim) - Melee J - Pause P"


def validate(config: dict) -> list[str]:
    errors = []
    if not isinstance(config.get("enemies"), list) or not config["enemies"]:
        errors.append("battle-2d config needs a non-empty 'enemies' list")
    if not isinstance(config.get("waves"), list) or not config["waves"]:
        errors.append("battle-2d config needs a non-empty 'waves' list")
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
                "radius = 13.0",
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
                '[sub_resource type="CircleShape2D" id="CircleShape2D_1"]',
                "radius = 5.0",
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
                'shape = SubResource("CircleShape2D_1")',
                "",
            ],
        ),
        "scenes/foe_shot.tscn": scene_text(
            resources=[
                '[ext_resource type="Script"'
                ' path="res://scripts/foe_shot.gd" id="1"]',
                f'[ext_resource type="Texture2D"'
                f' path="res://{_sprite(config, "foe-shot", "assets/foe-shot.png")}"'
                ' id="2"]',
            ],
            sub_resources=[
                '[sub_resource type="CircleShape2D" id="CircleShape2D_1"]',
                "radius = 5.0",
            ],
            nodes=[
                '[node name="FoeShot" type="Area2D" groups=["foe_shot"]]',
                "visible = false",
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
        "scripts/foe_shot.gd": _foe_shot_gd(),
        "scripts/pickup.gd": _pickup_gd(),
    }


def _main_gd() -> str:
    return '''extends Node2D
## Arena director: wave spawns at range, foe-shot pool, pickups, states.

const EnemyScene = preload("res://scenes/enemy.tscn")
const FoeShotScene = preload("res://scenes/foe_shot.tscn")
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
var min_spawn_dist: float = 240.0
var drop_chance: float = 0.0
var heal_amount: int = 1
var bonus_score: int = 50
var pickup_ttl: float = 12.0
var victory_after_wave: int = 1
var foe_pool: Array = []
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
	min_spawn_dist = float(GameConfig.section("spawning").get("minDistFromPlayer", 240.0))
	var pickups: Dictionary = GameConfig.section("pickups")
	drop_chance = float(pickups.get("dropChance", 0.0))
	heal_amount = int(pickups.get("healAmount", 1))
	bonus_score = int(pickups.get("bonusScore", 50))
	pickup_ttl = float(pickups.get("ttlMs", 12000)) / 1000.0
	victory_after_wave = int(GameConfig.section("victory").get("afterWave", 1))
	for e in GameConfig.data.get("enemies", []):
		enemy_stats[str(e.get("id", ""))] = e
	waves = GameConfig.data.get("waves", [])
	player.setup(player_cfg, GameConfig.section("ranged"), GameConfig.section("melee"))
	player.died.connect(_on_player_died)
	var foe_pool_size = int(GameConfig.section("foeShots").get("poolSize", 32))
	for i in foe_pool_size:
		var s = FoeShotScene.instantiate()
		add_child(s)
		foe_pool.append(s)
	hud.set_hint("Move WASD - Fire SPACE (auto-aim) - Melee J - Pause P")
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


func foe_fire(from: Vector2, dir: Vector2, speed: float) -> void:
	for s in foe_pool:
		if not s.active:
			s.activate(from, dir, speed)
			return


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


func _spawn_pos() -> Vector2:
	var bounds: Dictionary = GameConfig.section("player").get("bounds", {})
	var min_x = float(bounds.get("minX", 40.0))
	var max_x = float(bounds.get("maxX", 920.0))
	var min_y = float(bounds.get("minY", 70.0))
	var max_y = float(bounds.get("maxY", 500.0))
	var pos = Vector2(rng.randf_range(min_x, max_x), rng.randf_range(min_y, max_y))
	for attempt in 12:
		if pos.distance_to(player.position) >= min_spawn_dist:
			return pos
		pos = Vector2(rng.randf_range(min_x, max_x), rng.randf_range(min_y, max_y))
	return pos


func _spawn_enemy(enemy_id: String) -> void:
	if not enemy_stats.has(enemy_id):
		push_warning("battle-2d: unknown enemy id: " + enemy_id)
		return
	var diff: Dictionary = GameConfig.section("difficulty")
	var hp_scale = 1.0 + float(diff.get("enemyHealthScalePerWave", 0.0)) * float(wave_index)
	var sp_scale = 1.0 + float(diff.get("enemySpeedScalePerWave", 0.0)) * float(wave_index)
	var e = EnemyScene.instantiate()
	add_child(e)
	e.position = _spawn_pos()
	e.setup(enemy_stats[enemy_id], hp_scale, sp_scale, self)
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
		# Heal when hurt, otherwise bank bonus score.
		if player.health < player.max_health:
			p.setup("heal", heal_amount, pickup_ttl)
		else:
			p.setup("bonus", bonus_score, pickup_ttl)
		p.collected.connect(_on_pickup)
	_update_hud()


func _on_pickup(kind: String, amount: int) -> void:
	if kind == "heal":
		player.heal(amount)
	else:
		score += amount
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
	hud.show_message("Arena cleared! Score %d. Press fire to play again." % score)
	_update_hud()


func _update_hud() -> void:
	hud.set_score("Score %d" % score)
	hud.set_status("Wave %d/%d - Lives %d - HP %d" % [mini(wave_index + 1, waves.size()), waves.size(), lives, player.health])


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
## Arena hero: clamped movement, auto-aim bolts, spin melee, i-frames.

signal died

const ShotScene = preload("res://scenes/shot.tscn")

var speed: float = 280.0
var bounds = Rect2(40.0, 70.0, 880.0, 430.0)
var max_health: int = 3
var health: int = 3
var invuln_time: float = 1.2
var invuln_left: float = 0.0
var fire_cooldown: float = 0.2
var fire_left: float = 0.0
var projectile_speed: float = 560.0
var shot_damage: int = 1
var aim_range: float = 520.0
var melee_cooldown: float = 0.35
var melee_left: float = 0.0
var melee_damage: int = 2
var melee_range: float = 72.0
var alive: bool = true
var controls_enabled: bool = true
var spawn_pos = Vector2.ZERO
var pool: Array = []

@onready var sprite: Sprite2D = $Sprite2D


func setup(player_cfg: Dictionary, ranged: Dictionary, melee: Dictionary) -> void:
	speed = float(player_cfg.get("speed", 280.0))
	spawn_pos = Vector2(float(player_cfg.get("x", 480.0)), float(player_cfg.get("y", 300.0)))
	position = spawn_pos
	max_health = int(player_cfg.get("health", 3))
	health = max_health
	var b: Dictionary = player_cfg.get("bounds", {})
	var min_x = float(b.get("minX", 40.0))
	var min_y = float(b.get("minY", 70.0))
	bounds = Rect2(min_x, min_y, float(b.get("maxX", 920.0)) - min_x, float(b.get("maxY", 500.0)) - min_y)
	invuln_time = float(player_cfg.get("invulnerableMs", 1200)) / 1000.0
	fire_cooldown = float(ranged.get("cooldownMs", 200)) / 1000.0
	projectile_speed = float(ranged.get("projectileSpeed", 560.0))
	shot_damage = int(ranged.get("damage", 1))
	aim_range = float(ranged.get("aimRange", 520.0))
	melee_cooldown = float(melee.get("cooldownMs", 350)) / 1000.0
	melee_damage = int(melee.get("damage", 2))
	melee_range = float(melee.get("range", 72.0))
	var pool_size = int(ranged.get("poolSize", 32))
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
	fire_left = maxf(0.0, fire_left - delta)
	melee_left = maxf(0.0, melee_left - delta)
	if invuln_left > 0.0:
		invuln_left -= delta
		sprite.modulate.a = 0.35 + 0.65 * absf(sin(float(Time.get_ticks_msec()) / 60.0))
		if invuln_left <= 0.0:
			sprite.modulate.a = 1.0
	if Input.is_action_pressed("fire") and fire_left <= 0.0:
		_fire_at(_nearest_foe())
	if Input.is_action_just_pressed("melee") and melee_left <= 0.0:
		_spin_attack()


func _nearest_foe():
	var best = null
	var best_d = aim_range
	var foes: Array = get_tree().get_nodes_in_group("enemy")
	for f in foes:
		var d = position.distance_to(f.position)
		if d < best_d:
			best_d = d
			best = f
	return best


func _fire_at(target) -> void:
	if target == null:
		return
	for s in pool:
		if not s.active:
			var dir = (target.position - position).normalized()
			s.activate(position + dir * 16.0, dir, shot_damage, projectile_speed)
			fire_left = fire_cooldown
			return


func _spin_attack() -> void:
	melee_left = melee_cooldown
	var foes: Array = get_tree().get_nodes_in_group("enemy")
	for f in foes:
		if position.distance_to(f.position) <= melee_range and f.has_method("take_hit"):
			f.take_hit(melee_damage)
	var tween = create_tween()
	tween.tween_property(sprite, "rotation", TAU, 0.18)
	tween.tween_callback(func(): sprite.rotation = 0.0)


func take_hit() -> void:
	if not alive or invuln_left > 0.0:
		return
	health -= 1
	invuln_left = invuln_time
	if health <= 0:
		alive = false
		visible = false
		died.emit()


func heal(amount: int) -> void:
	health = mini(max_health, health + amount)


func respawn() -> void:
	position = spawn_pos
	health = max_health
	alive = true
	visible = true
	invuln_left = invuln_time
	fire_left = 0.0
	melee_left = 0.0
'''


def _enemy_gd() -> str:
    return '''extends Area2D
## Arena foe: chaser / weaver / shooter AI with contact damage.

signal killed(score_value: int, pos: Vector2)

var enemy_id: String = ""
var health: int = 1
var speed: float = 95.0
var damage: int = 1
var score_value: int = 100
var behavior: String = "chaser"
var amplitude: float = 0.0
var frequency: float = 0.0
var preferred_range: float = 260.0
var fire_range: float = 430.0
var fire_interval: float = 1.7
var foe_shot_speed: float = 250.0
var fire_left: float = 1.0
var age: float = 0.0
var director = null

@onready var sprite: Sprite2D = $Sprite2D
@onready var col: CollisionShape2D = $CollisionShape2D


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func setup(stats: Dictionary, hp_scale: float, sp_scale: float, p_director) -> void:
	director = p_director
	enemy_id = str(stats.get("id", "foe"))
	health = maxi(1, int(float(stats.get("health", 1)) * hp_scale))
	speed = float(stats.get("speed", 95.0)) * sp_scale
	damage = int(stats.get("damage", 1))
	score_value = int(stats.get("score", 0))
	var behavior_cfg: Dictionary = stats.get("behavior", {})
	behavior = str(behavior_cfg.get("type", "chaser"))
	amplitude = float(behavior_cfg.get("amplitude", 0.0))
	frequency = float(behavior_cfg.get("frequencyHz", 0.0))
	preferred_range = float(behavior_cfg.get("preferredRange", 260.0))
	fire_range = float(behavior_cfg.get("fireRange", 430.0))
	fire_interval = float(behavior_cfg.get("fireIntervalMs", 1700)) / 1000.0
	foe_shot_speed = float(behavior_cfg.get("projectileSpeed", 250.0))
	var tex_path = GameConfig.sprite_path(str(stats.get("sprite", "")))
	if tex_path != "" and ResourceLoader.exists(tex_path):
		sprite.texture = load(tex_path)
	var circle = CircleShape2D.new()
	circle.radius = float(stats.get("radius", 13.0))
	col.shape = circle


func _player():
	var heroes: Array = get_tree().get_nodes_in_group("player")
	if heroes.size() > 0:
		return heroes[0]
	return null


func _process(delta: float) -> void:
	age += delta
	var hero = _player()
	if hero == null:
		return
	var to_hero = hero.position - position
	var dist = to_hero.length()
	var dir = to_hero.normalized() if dist > 1.0 else Vector2.ZERO
	match behavior:
		"weaver":
			var side = Vector2(-dir.y, dir.x)
			var sway = sin(age * frequency * TAU) * amplitude
			position += (dir + side * sway).normalized() * speed * delta
		"shooter":
			if dist > preferred_range + 30.0:
				position += dir * speed * delta
			elif dist < preferred_range - 30.0:
				position -= dir * speed * delta
			else:
				position += Vector2(-dir.y, dir.x) * speed * 0.4 * delta
			fire_left -= delta
			if fire_left <= 0.0 and dist <= fire_range and director != null:
				fire_left = fire_interval
				director.foe_fire(position + dir * 14.0, dir, foe_shot_speed)
		_:
			position += dir * speed * delta


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
## Pooled auto-aimed bolt: flies straight, despawns on hit or off-arena.

var damage: int = 1
var speed: float = 560.0
var fly_dir = Vector2.RIGHT
var active: bool = false


func _ready() -> void:
	area_entered.connect(_on_area_entered)
	deactivate()


func activate(from: Vector2, dir: Vector2, p_damage: int, p_speed: float) -> void:
	position = from
	fly_dir = dir
	damage = p_damage
	speed = p_speed
	rotation = dir.angle()
	active = true
	visible = true
	set_process(true)
	set_deferred("monitoring", true)


func deactivate() -> void:
	active = false
	visible = false
	rotation = 0.0
	set_process(false)
	set_deferred("monitoring", false)


func _process(delta: float) -> void:
	position += fly_dir * speed * delta
	var size = GameConfig.world_size()
	if position.x < -30.0 or position.y < -30.0 or position.x > size.x + 30.0 or position.y > size.y + 30.0:
		deactivate()


func _on_area_entered(area: Area2D) -> void:
	if not active:
		return
	var target = area
	if target.is_in_group("enemy") and target.has_method("take_hit"):
		target.take_hit(damage)
		deactivate()
'''


def _foe_shot_gd() -> str:
    return '''extends Area2D
## Pooled foe bolt: hurts the player on contact, despawns off-arena.

var speed: float = 250.0
var fly_dir = Vector2.LEFT
var active: bool = false


func _ready() -> void:
	body_entered.connect(_on_body_entered)
	deactivate()


func activate(from: Vector2, dir: Vector2, p_speed: float) -> void:
	position = from
	fly_dir = dir
	speed = p_speed
	rotation = dir.angle()
	active = true
	visible = true
	set_process(true)
	set_deferred("monitoring", true)


func deactivate() -> void:
	active = false
	visible = false
	rotation = 0.0
	set_process(false)
	set_deferred("monitoring", false)


func _process(delta: float) -> void:
	position += fly_dir * speed * delta
	var size = GameConfig.world_size()
	if position.x < -30.0 or position.y < -30.0 or position.x > size.x + 30.0 or position.y > size.y + 30.0:
		deactivate()


func _on_body_entered(body: Node2D) -> void:
	if not active:
		return
	var target = body
	if target.is_in_group("player") and target.has_method("take_hit"):
		target.take_hit()
		deactivate()
'''


def _pickup_gd() -> str:
    return '''extends Area2D
## Arena pickup: heal or bonus score, blinks and expires after its TTL.

signal collected(kind: String, amount: int)

var kind: String = "bonus"
var amount: int = 50
var ttl: float = 12.0

@onready var sprite: Sprite2D = $Sprite2D


func setup(p_kind: String, p_amount: int, p_ttl: float) -> void:
	kind = p_kind
	amount = p_amount
	ttl = p_ttl


func _ready() -> void:
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	ttl -= delta
	if ttl <= 0.0:
		queue_free()
		return
	if ttl < 2.0:
		sprite.modulate.a = 0.3 + 0.7 * absf(sin(float(Time.get_ticks_msec()) / 90.0))


func _on_body_entered(body: Node2D) -> void:
	var target = body
	if target.is_in_group("player"):
		collected.emit(kind, amount)
		queue_free()
'''
