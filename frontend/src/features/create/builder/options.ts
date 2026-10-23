export type BuilderMode = "character" | "scene";

export interface BuilderOption {
  id: string;
  /** what the chip shows */
  label: string;
  /** the words that go into the prompt, written to fit the field's slot in buildPrompt */
  text: string;
}

export interface BuilderField {
  id: string;
  label: string;
  /** the section it sits in, in the sheet */
  group: string;
  /** always filled in by Randomize (the rest are filled about half the time, to keep prompts short) */
  core?: boolean;
  options: BuilderOption[];
}

/** Options whose label is also their text. */
const same = (...labels: string[]): BuilderOption[] => labels.map((l) => ({ id: slug(l), label: l, text: l }));
/** Mood options: the label is shown, "<label> atmosphere" goes into the prompt. */
const moods = (...labels: string[]): BuilderOption[] => labels.map((l) => ({ id: slug(l), label: l, text: `${l.toLowerCase()} atmosphere` }));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const opt = (label: string, text: string): BuilderOption => ({ id: slug(label), label, text });

// Wording was checked against real Krea 2 renders: concrete visual phrases are followed; "low angle" only works spelled out as
// "from ground level looking up", and body builds work as "a <word> build". Ages are adult only.
export const CHARACTER_FIELDS: BuilderField[] = [
  {
    id: "gender",
    label: "Gender",
    group: "Who",
    core: true,
    options: [opt("Woman", "woman"), opt("Man", "man")],
  },
  {
    id: "age",
    label: "Age",
    group: "Who",
    options: [opt("Young adult", "young"), opt("Adult", "adult"), opt("Middle-aged", "middle-aged"), opt("Elderly", "elderly")],
  },
  {
    id: "ethnicity",
    label: "Ethnicity",
    group: "Who",
    core: true,
    options: same("East Asian", "Southeast Asian", "Filipino", "Japanese", "Korean", "Chinese", "South Asian", "Indian", "Black", "White", "Scandinavian", "Latino", "Middle Eastern", "Mediterranean"),
  },
  {
    id: "height",
    label: "Height",
    group: "Who",
    options: [opt("Tall", "tall"), opt("Short / petite", "petite")],
  },
  {
    id: "build",
    label: "Body build",
    group: "Who",
    options: [
      opt("Slim", "a slim, slender build"),
      opt("Athletic", "an athletic build"),
      opt("Muscular", "a muscular, heavily toned build"),
      opt("Curvy", "a curvy build"),
      opt("Plus-size", "a full-figured, plus-size build"),
      opt("Average", "an average build"),
    ],
  },
  {
    id: "hair",
    label: "Hair",
    group: "Who",
    options: [
      opt("Long black", "long black hair"),
      opt("Short black", "short black hair"),
      opt("Brown wavy", "wavy brown hair"),
      opt("Blonde", "blonde hair"),
      opt("Red", "red hair"),
      opt("Curly / afro", "curly natural hair"),
      opt("Ponytail", "hair in a ponytail"),
      opt("Bob cut", "a sleek bob haircut"),
      opt("Buzz cut", "a buzz cut"),
      opt("Gray", "gray hair"),
      opt("Bald", "a shaved head"),
    ],
  },
  {
    id: "clothing",
    label: "Clothing",
    group: "Look",
    options: [
      opt("White tee & jeans", "a plain white t-shirt and jeans"),
      opt("Streetwear", "an oversized hoodie and cargo pants"),
      opt("Business suit", "a tailored business suit"),
      opt("Summer dress", "a flowing summer dress"),
      opt("Athletic wear", "fitted athletic wear"),
      opt("Leather jacket", "a black leather jacket"),
      opt("Trench coat", "a red trench coat"),
      opt("Evening wear", "elegant evening wear"),
      opt("Knit sweater", "a chunky knit sweater"),
      opt("Traditional", "traditional clothing"),
    ],
  },
  {
    id: "pose",
    label: "Pose",
    group: "Look",
    options: [
      opt("Standing", "standing relaxed"),
      opt("Walking", "mid-stride walking toward the camera"),
      opt("Sitting", "sitting casually"),
      opt("Cross-legged", "sitting cross-legged"),
      opt("Leaning", "leaning against a wall"),
      opt("Arms crossed", "standing with arms crossed"),
      opt("Over shoulder", "glancing back over one shoulder"),
      opt("Hands in pockets", "standing with hands in pockets"),
      opt("Running", "running"),
      opt("Dancing", "caught mid-dance"),
    ],
  },
  {
    id: "expression",
    label: "Expression",
    group: "Look",
    options: [
      opt("Soft smile", "a soft smile"),
      opt("Laughing", "laughing candidly"),
      opt("Serious", "a serious expression"),
      opt("Confident", "a confident smirk"),
      opt("Thoughtful", "a thoughtful expression"),
      opt("Calm", "a calm neutral expression"),
    ],
  },
  {
    id: "gaze",
    label: "Gaze",
    group: "Look",
    options: [opt("At the camera", "looking at the camera"), opt("Away", "looking away from the camera"), opt("Down", "looking down"), opt("Up", "gazing upward")],
  },
  {
    id: "framing",
    label: "Framing",
    group: "Camera",
    core: true,
    options: [opt("Full body", "Full-body"), opt("Knee up", "Knee-up"), opt("Waist up", "Waist-up"), opt("Close-up", "Close-up"), opt("Headshot", "Headshot")],
  },
  {
    id: "look",
    label: "Look",
    group: "Camera",
    options: [
      opt("Photo", "photo"),
      opt("Candid snapshot", "candid snapshot"),
      opt("Cinematic film still", "cinematic film still"),
      opt("Editorial fashion", "editorial fashion photo"),
      opt("Studio portrait", "studio portrait"),
    ],
  },
  {
    id: "angle",
    label: "Camera angle",
    group: "Camera",
    options: [
      opt("Eye level", "eye-level shot"),
      opt("Low angle", "dramatic low-angle shot from ground level looking up, the figure towering against the sky"),
      opt("High angle", "shot from a high angle looking down"),
      opt("Side profile", "side profile view"),
      opt("Three-quarter", "three-quarter view"),
      opt("From behind", "shot from behind"),
      opt("Over the shoulder", "over-the-shoulder shot"),
      opt("Tilted", "tilted dutch-angle shot"),
    ],
  },
  {
    id: "lens",
    label: "Lens",
    group: "Camera",
    options: [
      opt("Shallow focus", "shallow depth of field, softly blurred background"),
      opt("85mm portrait", "85mm portrait lens"),
      opt("Wide-angle", "wide-angle lens"),
      opt("Telephoto", "telephoto lens with compressed background"),
      opt("Sharp everywhere", "deep focus, everything sharp"),
    ],
  },
  {
    id: "lighting",
    label: "Lighting",
    group: "Light",
    core: true,
    options: [
      opt("Soft daylight", "soft natural daylight"),
      opt("Golden hour", "warm golden hour light"),
      opt("Overcast", "soft overcast light"),
      opt("Harsh sun", "harsh midday sun with strong shadows"),
      opt("Studio softbox", "soft studio softbox lighting"),
      opt("Rim light", "dramatic rim lighting from behind"),
      opt("Neon night", "neon pink and blue lighting at night"),
      opt("Low-key", "moody low-key lighting"),
      opt("Backlit", "strong backlight with a glowing edge"),
      opt("Candlelight", "warm candlelight"),
    ],
  },
  {
    id: "mood",
    label: "Mood",
    group: "Light",
    options: moods("Cinematic", "Moody", "Bright and cheerful", "Serene", "Gritty", "Dreamy", "Intimate"),
  },
  {
    id: "setting",
    label: "Setting",
    group: "Where",
    core: true,
    options: [
      opt("City street", "in a sunlit city street"),
      opt("Café", "in a cozy café"),
      opt("Park", "in a green park"),
      opt("Beach", "on a sandy beach"),
      opt("Forest", "in a misty forest"),
      opt("Rooftop at night", "on a city rooftop at night"),
      opt("Rainy street", "on a rainy city street"),
      opt("Studio backdrop", "against a plain studio backdrop"),
      opt("Bedroom", "in a bright bedroom"),
      opt("Market", "in a busy outdoor market"),
      opt("Desert", "in a desert at sunset"),
      opt("Snow", "in a snowy landscape"),
      opt("Office", "in a modern office"),
      opt("Library", "in an old library"),
    ],
  },
];

export const SCENE_FIELDS: BuilderField[] = [
  {
    id: "place",
    label: "Place",
    group: "What",
    core: true,
    options: [
      opt("Mountain lake", "a mountain lake"),
      opt("Snowy peaks", "snow-capped mountains"),
      opt("Forest", "a dense pine forest"),
      opt("Coastline", "a rocky coastline"),
      opt("Tropical beach", "a tropical beach with turquoise water"),
      opt("Desert dunes", "vast desert dunes"),
      opt("Countryside", "rolling green countryside"),
      opt("Waterfall", "a waterfall in a lush valley"),
      opt("Old-town street", "a narrow cobblestone old-town street"),
      opt("City skyline", "a modern city skyline"),
      opt("Night market", "a busy night market street with colorful stalls and glowing lanterns"),
      opt("Cozy interior", "a cozy interior room"),
      opt("Ancient ruins", "ancient stone ruins"),
      opt("Sci-fi city", "a futuristic sci-fi city"),
      opt("Fantasy castle", "a fantasy castle on a cliff"),
      opt("Farm field", "a golden wheat field"),
    ],
  },
  {
    id: "composition",
    label: "Composition",
    group: "What",
    options: [
      opt("Wide", "Wide landscape photo"),
      opt("Wide-angle", "Wide-angle photo"),
      opt("Aerial drone", "Aerial drone photo"),
      opt("Panoramic", "Panoramic photo"),
      opt("Eye level", "Eye-level photo"),
      opt("Low angle", "Low-angle photo"),
      opt("Symmetrical", "Symmetrical, centered photo"),
      opt("Cinematic still", "Cinematic film still"),
    ],
  },
  {
    id: "foreground",
    label: "Foreground",
    group: "Layers",
    options: [
      opt("Wet rocks", "wet rocks and tide pools"),
      opt("Wildflowers", "wildflowers"),
      opt("Tall grass", "tall grass"),
      opt("Boulders", "mossy boulders"),
      opt("Water ripples", "gentle water ripples"),
      opt("Cobblestones", "wet cobblestones"),
      opt("Pine trees", "dark pine trees"),
      opt("Market stalls", "market stalls"),
    ],
  },
  {
    id: "distance",
    label: "In the distance",
    group: "Layers",
    options: [
      opt("Mountains", "mountains"),
      opt("Hazy hills", "hazy rolling hills"),
      opt("City skyline", "a hazy city skyline"),
      opt("Lighthouse", "a lone lighthouse on a cliff"),
      opt("Ocean horizon", "the ocean horizon"),
      opt("Dramatic clouds", "dramatic clouds"),
      opt("Castle", "a distant castle"),
      opt("Glowing lights", "glowing lights"),
    ],
  },
  {
    id: "time",
    label: "Time of day",
    group: "Sky & light",
    core: true,
    options: [
      opt("Sunrise", "at sunrise"),
      opt("Golden hour", "at golden hour"),
      opt("Midday", "at midday"),
      opt("Blue hour", "at blue hour"),
      opt("Dusk", "at dusk"),
      opt("Night", "at night"),
      opt("Starry night", "at night under a sky full of stars"),
      opt("Moonlit", "under a full moon"),
    ],
  },
  {
    id: "weather",
    label: "Weather",
    group: "Sky & light",
    options: [
      opt("Clear", "clear sky"),
      opt("Misty", "rising mist"),
      opt("Fog", "thick fog"),
      opt("Rain", "falling rain"),
      opt("Storm", "dark storm clouds"),
      opt("Snowfall", "falling snow"),
      opt("Overcast", "an overcast sky"),
      opt("Dramatic clouds", "dramatic clouds"),
    ],
  },
  {
    id: "season",
    label: "Season",
    group: "Sky & light",
    options: [opt("Spring", "spring blossoms"), opt("Summer", "lush summer greenery"), opt("Autumn", "autumn foliage"), opt("Winter", "a winter landscape")],
  },
  {
    id: "lighting",
    label: "Lighting",
    group: "Sky & light",
    core: true,
    options: [
      opt("Soft haze", "soft hazy light"),
      opt("Warm lamplight", "warm lamplight"),
      opt("God rays", "sunbeams streaming through"),
      opt("Soft diffused", "soft diffused light"),
      opt("High contrast", "high-contrast light and deep shadows"),
      opt("Neon glow", "colorful neon glow"),
      opt("Backlit", "strong backlight"),
    ],
  },
  {
    id: "mood",
    label: "Mood",
    group: "Feel",
    options: moods("Serene", "Epic", "Moody", "Mysterious", "Cozy", "Lonely", "Dreamy", "Majestic"),
  },
  {
    id: "lens",
    label: "Lens",
    group: "Feel",
    options: [
      opt("Wide-angle", "wide-angle lens"),
      opt("Telephoto", "telephoto lens with compressed layers"),
      opt("Shallow focus", "shallow depth of field in the foreground"),
      opt("Deep focus", "deep focus, sharp from front to back"),
    ],
  },
  {
    id: "people",
    label: "People",
    group: "Feel",
    options: [
      opt("None", "no people"),
      opt("A few, distant", "a few distant people in the background, small and out of focus, not the focus of the image"),
      opt("Crowd", "a crowd of people small in the frame, the scene itself is the focus, nobody in close-up"),
      opt("One tiny figure", "a single tiny lone figure for a sense of scale"),
    ],
  },
];

export const FIELDS: Record<BuilderMode, BuilderField[]> = { character: CHARACTER_FIELDS, scene: SCENE_FIELDS };

export const MODE_LABELS: Record<BuilderMode, { label: string; hint: string }> = {
  character: { label: "Character", hint: "A person is the focus of the image." },
  scene: { label: "Scene", hint: "A place or landscape is the focus. People, if any, stay in the background." },
};

// ---------------------------------------------------------------------------------------------------------------------
// Typed-in text. A field's chips hold ready-made phrases; text typed into its box is bare ("navy raincoat", "tired"), so
// each field says how to dress it into a phrase that fits its slot in buildPrompt. A phrase that already reads right is kept.

export interface CustomSpec {
  /** placeholder for the box */
  example: string;
  /** bare text -> the phrase that goes into the prompt (default: as typed) */
  wrap?: (text: string) => string;
  /** true = the text is not allowed, so it is left out of the prompt (and the box says why) */
  reject?: (text: string) => boolean;
  /** shown under the box while the text is rejected */
  rejectNote?: string;
}

const hasArticle = (t: string) => /^(a|an|the|some|his|her|their|two|three|several|many)\s/i.test(t);
/** "mountain lake" -> "a mountain lake"; plurals and phrases that already start with an article stay as they are. */
const withArticle = (t: string) => (hasArticle(t) || /s$/i.test(t) ? t : `${/^[aeiou]/i.test(t) ? "an" : "a"} ${t}`);
const addTo = (t: string, re: RegExp, suffix: string) => (re.test(t) ? t : `${t} ${suffix}`);
const startsWith = (t: string, re: RegExp, prefix: string) => (re.test(t) ? t : `${prefix} ${t}`);

/** The age box is adults only, like the chips: a number under 18, or a word for a child or teenager, is refused. */
const UNDERAGE_WORDS = /(?<![a-z])(child|children|kid|kids|boy|girl|baby|toddler|infant|teen|teens|teenage|teenager|preteen|tween|minor|juvenile|adolescent|schoolboy|schoolgirl|underage)(?![a-z])/i;
/** "35", "young 20", "early 30s", "42 years old" -> the words before the number, the number, and whether it was a decade ("30s"). */
const ageParts = (t: string) => /^(.*?)\s*(\d{1,3})(s|\s*[- ]?(?:years?[- ]old|yo|y\/o))?$/i.exec(t);
const age: CustomSpec = {
  example: "e.g. 35, young 20, or weathered old",
  reject: (t) => UNDERAGE_WORDS.test(t) || (/\d/.test(t) && !(t.match(/\d+/g) ?? []).every((n) => Number(n) >= 18)),
  rejectNote: "Adults only: use an age of 18 or more.",
  wrap: (t) => {
    const m = ageParts(t);
    if (!m) return t;
    const [, before, n, suffix] = m;
    return `${before ? `${before} ` : ""}${Number(n)}${suffix?.toLowerCase() === "s" ? "-something" : "-year-old"}`;
  },
};

const lighting: CustomSpec = { example: "e.g. warm orange sunset glow", wrap: (t) => addTo(t, /light|lit\b|glow|sun|shadow|lamp|candle|neon/i, "lighting") };
const mood: CustomSpec = { example: "e.g. nostalgic", wrap: (t) => addTo(t, /atmosphere|mood|feel/i, "atmosphere") };
const lens: CustomSpec = { example: "e.g. 35mm", wrap: (t) => addTo(t, /lens|depth|focus|bokeh/i, "lens") };

/** Per mode and field id. `false` = no typed-in text (gender stays a choice). */
export const CUSTOM: Record<BuilderMode, Record<string, CustomSpec | false>> = {
  character: {
    gender: false,
    age,
    ethnicity: { example: "e.g. Thai" },
    height: { example: "e.g. very tall" },
    build: { example: "e.g. broad-shouldered", wrap: (t) => (hasArticle(t) || /build|physique|frame/i.test(t) ? t : `a ${t} build`) },
    hair: { example: "e.g. messy auburn", wrap: (t) => addTo(t, /hair|cut|bald|braid|bun\b|ponytail|afro|locs|mohawk|bangs|fringe/i, "hair") },
    clothing: { example: "e.g. a navy raincoat" },
    pose: { example: "e.g. tying her shoe" },
    expression: { example: "e.g. tired", wrap: (t) => (/expression|smile|grin|smirk|frown|laugh|stare|look/i.test(t) ? (hasArticle(t) ? t : `a ${t}`) : `a ${t} expression`) },
    gaze: { example: "e.g. at the sunset", wrap: (t) => startsWith(t, /^(looking|gazing|staring|glancing|eyes)/i, "looking") },
    framing: { example: "e.g. Three-quarter length" },
    look: { example: "e.g. polaroid photo" },
    angle: { example: "e.g. bird's-eye", wrap: (t) => (/^(from|shot|seen|taken)|shot|view|angle/i.test(t) ? t : `${t} shot`) },
    lens,
    lighting,
    mood,
    setting: { example: "e.g. a bamboo forest", wrap: (t) => startsWith(t, /^(in|on|at|against|inside|outside|under|near|by|beside|among|along|beneath|above|across|within|beyond|next)\b/i, "in") },
  },
  scene: {
    place: { example: "e.g. a volcanic crater lake", wrap: withArticle },
    composition: { example: "e.g. drone shot", wrap: (t) => addTo(t, /photo|shot|still|view|image|painting|render/i, "photo") },
    foreground: { example: "e.g. red poppies" },
    distance: { example: "e.g. a rusty bridge" },
    time: { example: "e.g. twilight", wrap: (t) => startsWith(t, /^(at|during|under|in|before|after|just)\b/i, "at") },
    weather: { example: "e.g. light drizzle" },
    season: { example: "e.g. early spring" },
    lighting,
    mood,
    lens,
    people: { example: "e.g. two hikers, small in the frame" },
  },
};
