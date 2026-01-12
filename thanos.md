# Thanos Bot Routine

## Connection Details
```json
{
  "host": "centerbeam.proxy.rlwy.net",
  "port": 40387,
  "username": "thanos",
  "auth": "offline"
}
```

## Quick Commands

### Wrath of God
Strike all hostile mobs with lightning.
```javascript
const hostileTypes = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch',
  'phantom', 'drowned', 'husk', 'stray', 'pillager', 'vindicator', 'ravager', 'warden',
  'zombie_villager', 'cave_spider', 'silverfish', 'slime', 'magma_cube', 'blaze', 'ghast'];

const hostiles = Object.values(bot.entities).filter(e => {
  if (!e.name || !e.position) return false;
  return hostileTypes.some(h => e.name.includes(h));
});

let struck = 0;
for (const mob of hostiles) {
  const x = Math.floor(mob.position.x);
  const y = Math.floor(mob.position.y);
  const z = Math.floor(mob.position.z);
  bot.chat(`/summon lightning_bolt ${x} ${y} ${z}`);
  struck++;
  await new Promise(r => setTimeout(r, 100));
}

return `Struck ${struck} hostile mobs with lightning!`;
```

### Teleport to Player
```javascript
bot.chat('/tp lmoik');
await new Promise(r => setTimeout(r, 1000));
const pos = bot.entity.position;
return `Teleported to (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`;
```

### Fly to Player
```javascript
const player = bot.players['lmoik'];
if (!player?.entity) return 'Cannot see player';

const target = player.entity.position.clone();
bot.creative.startFlying();
await bot.creative.flyTo(target);
return `Flew to (${Math.round(target.x)}, ${Math.round(target.y)}, ${Math.round(target.z)})`;
```

### Nuke Area (64x64 to bedrock)
```javascript
const pos = bot.entity.position;
const x = Math.floor(pos.x);
const y = Math.floor(pos.y);
const z = Math.floor(pos.z);

bot.chat(`//pos1 ${x-32},${y+20},${z-32}`);
await new Promise(r => setTimeout(r, 500));
bot.chat(`//pos2 ${x+32},${-64},${z+32}`);
await new Promise(r => setTimeout(r, 500));
bot.chat('//set air');

return `Nuked 64x64 area around (${x}, ${y}, ${z})`;
```

### Create Bedrock Bowl
Creates bedrock floor and walls around a nuked area.
```javascript
// Set these to match the nuked area corners
const x1 = X_MIN, z1 = Z_MIN;
const x2 = X_MAX, z2 = Z_MAX;
const bottomY = -64;
const topY = TOP_Y;

// Floor
bot.chat(`//pos1 ${x1},${bottomY},${z1}`);
await new Promise(r => setTimeout(r, 500));
bot.chat(`//pos2 ${x2},${bottomY},${z2}`);
await new Promise(r => setTimeout(r, 500));
bot.chat('//set bedrock');
await new Promise(r => setTimeout(r, 500));

// 4 Walls
for (const [wx1, wz1, wx2, wz2] of [
  [x1, z1, x2, z1], // North
  [x1, z2, x2, z2], // South
  [x1, z1, x1, z2], // West
  [x2, z1, x2, z2]  // East
]) {
  bot.chat(`//pos1 ${wx1},${bottomY},${wz1}`);
  await new Promise(r => setTimeout(r, 500));
  bot.chat(`//pos2 ${wx2},${topY},${wz2}`);
  await new Promise(r => setTimeout(r, 500));
  bot.chat('//set bedrock');
  await new Promise(r => setTimeout(r, 500));
}

return 'Bedrock bowl complete!';
```

### Remove Block Type in Area
```javascript
const pos = bot.entity.position;
const x = Math.floor(pos.x);
const y = Math.floor(pos.y);
const z = Math.floor(pos.z);

bot.chat(`//pos1 ${x-100},${-64},${z-100}`);
await new Promise(r => setTimeout(r, 500));
bot.chat(`//pos2 ${x+100},${200},${z+100}`);
await new Promise(r => setTimeout(r, 500));
bot.chat('//replace BLOCK_NAME air');

return 'Removed blocks';
```

### Check Status
```javascript
const pos = bot.entity.position;
return {
  position: `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`,
  health: bot.health,
  food: bot.food,
  gamemode: bot.game.gameMode,
  players: Object.keys(bot.players).join(', ')
};
```

## Notes
- Thanos has creative/op powers for WorldEdit and commands
- Use `//set air` to clear areas, `//replace X air` to remove specific blocks
- Lightning strikes require `/summon lightning_bolt x y z`
