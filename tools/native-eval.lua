-- Numerical evidence only. Loaded in a disposable local map, with original game rules.
local Config = __CONFIG__
local A, B, started, av, bv
local finished = false
local assigned = {}
local function Cell(x, y)
  if Config.ra2 then return CPos.New(x + 34, y - 30) end
  return CPos.New(x, y)
end
local function Alive(group)
  local result = {}
  for _, actor in ipairs(group) do if not actor.IsDead and actor.IsInWorld then result[#result + 1] = actor end end
  return result
end
local function Left(group)
  local value = 0
  for _, actor in ipairs(Alive(group)) do value = value + math.floor(Actor.Cost(actor.Type) * actor.Health / actor.MaxHealth) end
  return value
end
local function Spawn(owner, actorType, x)
  local group = {}
  for i = 1, Config.count do
    local actor = Actor.Create(actorType, true, { Owner = owner, Location = Cell(x, 16 + i * 4), Facing = x < 32 and Angle.East or Angle.West })
    actor.Stance = "Defend"
    group[#group + 1] = actor
  end
  return group
end
local function Direct(group, enemies, policy)
  local targets = Alive(enemies)
  if #targets == 0 then return end
  for _, actor in ipairs(Alive(group)) do
    if actor.HasProperty("Attack") then
      local selected, best = nil, nil
      for _, target in ipairs(targets) do
        local score
        if policy == "focus" then score = target.Health
        else local d = target.Location - actor.Location; score = d.X * d.X + d.Y * d.Y end
        if actor.CanTarget(target) and (best == nil or score < best) then selected, best = target, score end
      end
      -- Native Attack's allowMove preserves stationary hold without inventing range/damage logic.
      if selected ~= nil and (assigned[actor] ~= selected or actor.IsIdle) then
        actor.Stop()
        actor.Attack(selected, policy ~= "hold")
        assigned[actor] = selected
      end
    end
  end
end
WorldLoaded = function()
  local ax, bx = 26, 38
  if Config.mirror then ax, bx = bx, ax end
  A = Spawn(Player.GetPlayer("DuelA"), Config.a, ax)
  B = Spawn(Player.GetPlayer("DuelB"), Config.b, bx)
  av, bv = Actor.Cost(Config.a) * Config.count, Actor.Cost(Config.b) * Config.count
  started = DateTime.GameTime
end
Tick = function()
  if finished or A == nil then return end
  local elapsed = DateTime.GameTime - started
  if elapsed % 25 ~= 0 then return end
  local aa, ba = #Alive(A), #Alive(B)
  if aa == 0 or ba == 0 or elapsed >= Config.duration * 25 then
    finished = true
    print(table.concat({ "EVAL", elapsed, Left(A), Left(B), aa, ba, av, bv }, "|"))
    local player = Player.GetPlayer("Multi0")
    local objective = player.AddPrimaryObjective("Behavior test completed")
    player.MarkFailedObjective(objective)
    return
  end
  Direct(A, B, Config.policy)
  Direct(B, A, Config.opponent)
end
