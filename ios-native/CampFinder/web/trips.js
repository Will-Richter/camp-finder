/* Ready-made trips for the Discover tab. Distances and times are rough guides. */
(() => {
  const P = (name, lat, lon) => ({ name, lat, lon });
  window.CF_TRIPS = [
    {
      id: "biglap", name: "The Big Lap", emoji: "🇦🇺", art: ["#0E5A3E", "#D98A4A"],
      tagline: "All the way around Australia", km: 14500, nights: 90, season: "Start up north in autumn and follow the dry season", road: "Sealed (Highway 1)",
      stops: [P("Brisbane", -27.47, 153.03), P("Cairns", -16.92, 145.77), P("Darwin", -12.46, 130.84), P("Broome", -17.96, 122.24), P("Perth", -31.95, 115.86), P("Adelaide", -34.93, 138.6), P("Melbourne", -37.81, 144.96), P("Sydney", -33.87, 151.21), P("Brisbane", -27.47, 153.03)],
      highlights: ["Great Barrier Reef and the Daintree", "Kakadu and Litchfield near Darwin", "Cable Beach sunsets in Broome", "The Nullarbor and Great Australian Bight", "Great Ocean Road"],
      tips: "Most people take 3 to 12 months. Plan fuel carefully across the Nullarbor and the top end, and book ahead in school holidays.",
    },
    {
      id: "bruce", name: "Bundaberg to Cairns", emoji: "🌴", art: ["#0E7C86", "#F5C518"],
      tagline: "The Bruce Highway run up the Queensland coast", km: 1400, nights: 7, season: "April to October", road: "Sealed",
      stops: [P("Bundaberg", -24.87, 152.35), P("Agnes Water", -24.21, 151.9), P("Rockhampton", -23.38, 150.51), P("Airlie Beach", -20.27, 148.72), P("Townsville", -19.26, 146.82), P("Mission Beach", -17.87, 146.11), P("Cairns", -16.92, 145.77)],
      highlights: ["Agnes Water and 1770", "The Whitsundays from Airlie Beach", "Magnetic Island off Townsville", "Mission Beach rainforest and cassowaries"],
      tips: "Lots of free rest areas along the Bruce. Agnes Water has strict no-free-camping rules, so use a campground there.",
    },
    {
      id: "kgari", name: "Fraser Coast and K'gari", emoji: "🏝️", art: ["#2F6FD6", "#F5DFA0"],
      tagline: "Beaches, whales and the world's largest sand island", km: 330, nights: 4, season: "All year; whales July to November", road: "Sealed, 4WD on K'gari",
      stops: [P("Bundaberg", -24.87, 152.35), P("Hervey Bay", -25.29, 152.84), P("Rainbow Beach", -25.9, 153.09)],
      highlights: ["Whale watching from Hervey Bay", "Ferry to K'gari from River Heads or Inskip Point", "Lake McKenzie and Seventy-Five Mile Beach", "Carlo Sand Blow at Rainbow Beach"],
      tips: "You need a vehicle access permit and camping permits for K'gari. Check tide times before driving the beach.", guide: "kgari",
    },
    {
      id: "gor", name: "Great Ocean Road", emoji: "🌊", art: ["#1F4E79", "#9FC5E8"],
      tagline: "Cliffs, surf and the Twelve Apostles", km: 300, nights: 3, season: "All year; quieter outside summer", road: "Sealed, winding",
      stops: [P("Torquay", -38.33, 144.33), P("Lorne", -38.54, 143.97), P("Apollo Bay", -38.76, 143.67), P("Port Campbell", -38.62, 142.99), P("Port Fairy", -38.38, 142.24)],
      highlights: ["Bells Beach", "Koalas at Kennett River", "Twelve Apostles at sunrise", "Loch Ard Gorge"],
      tips: "Narrow and winding with big rigs: allow extra time. Many camps book out on weekends.",
    },
    {
      id: "redcentre", name: "Red Centre Way", emoji: "🪨", art: ["#A84D22", "#F5A742"],
      tagline: "Alice Springs, the West MacDonnells, Kings Canyon and Uluru", km: 850, nights: 5, season: "April to September", road: "Mostly sealed; Mereenie Loop is unsealed",
      stops: [P("Alice Springs", -23.7, 133.88), P("Glen Helen", -23.69, 132.67), P("Kings Canyon", -24.25, 131.57), P("Yulara (Uluru)", -25.24, 130.99)],
      highlights: ["Swims at Ellery Creek and Ormiston Gorge", "Kings Canyon Rim Walk", "Sunrise and sunset at Uluru", "Kata Tjuta Valley of the Winds"],
      tips: "Carry plenty of water. The Mereenie Loop needs a permit and suits 4WDs. The national park needs a park pass.",
    },
    {
      id: "nullarbor", name: "Across the Nullarbor", emoji: "🐪", art: ["#8C6D3F", "#E9D7A5"],
      tagline: "Adelaide to Esperance on the longest straight road", km: 2100, nights: 6, season: "Autumn and spring", road: "Sealed",
      stops: [P("Adelaide", -34.93, 138.6), P("Port Augusta", -32.49, 137.77), P("Ceduna", -32.13, 133.68), P("Eucla", -31.68, 128.88), P("Norseman", -32.2, 121.78), P("Esperance", -33.86, 121.89)],
      highlights: ["Head of Bight whale watching (June to October)", "Bunda Cliffs lookouts", "The 90 Mile Straight", "Lucky Bay kangaroos near Esperance"],
      tips: "Fuel is expensive and roadhouses are far apart. There's a quarantine check at the WA border: no fruit, vegetables or honey.",
    },
    {
      id: "savannah", name: "Savannah Way", emoji: "🐊", art: ["#6B8E23", "#F5C518"],
      tagline: "Cairns to Broome across the top of Australia", km: 3700, nights: 14, season: "May to October (dry season)", road: "Mixed; long unsealed sections",
      stops: [P("Cairns", -16.92, 145.77), P("Normanton", -17.67, 141.08), P("Borroloola", -16.07, 136.31), P("Katherine", -14.47, 132.26), P("Kununurra", -15.77, 128.74), P("Broome", -17.96, 122.24)],
      highlights: ["Undara lava tubes", "Barramundi fishing in the Gulf", "Katherine Gorge and Edith Falls", "Lake Argyle near Kununurra"],
      tips: "A high-clearance 4WD is recommended between Normanton and Roper Bar. Apple Maps may route you on sealed roads instead; check road reports.",
    },
    {
      id: "gibb", name: "Gibb River Road", emoji: "🏜️", art: ["#B5582C", "#6B4E35"],
      tagline: "The Kimberley's legendary 4WD track", km: 700, nights: 7, season: "June to September", road: "Unsealed, 4WD only",
      stops: [P("Derby", -17.3, 123.63), P("Windjana Gorge", -17.41, 124.94), P("Mount Barnett", -16.65, 125.95), P("El Questro", -16.01, 128.0), P("Kununurra", -15.77, 128.74)],
      highlights: ["Windjana Gorge freshwater crocs", "Bell Gorge swimming hole", "Manning Gorge", "El Questro hot springs"],
      tips: "Carry two spare tyres, extra fuel and water. Roads close after rain. Apple Maps may suggest the sealed Great Northern Highway instead.",
    },
    {
      id: "tassie", name: "Tassie East Coast", emoji: "🍷", art: ["#2E6B43", "#E9A35F"],
      tagline: "Hobart to Launceston via Freycinet and the Bay of Fires", km: 460, nights: 5, season: "November to April", road: "Sealed",
      stops: [P("Hobart", -42.88, 147.33), P("Swansea", -42.12, 148.07), P("Coles Bay (Freycinet)", -42.12, 148.29), P("Bicheno", -41.87, 148.3), P("St Helens", -41.32, 148.25), P("Launceston", -41.44, 147.14)],
      highlights: ["Wineglass Bay lookout", "Penguins at Bicheno", "Orange-lichen rocks at the Bay of Fires", "Cataract Gorge in Launceston"],
      tips: "Lots of free camps along the coast. Book the Spirit of Tasmania early in summer.",
    },
    {
      id: "pacific", name: "Pacific Coast Way", emoji: "🏄", art: ["#0E5A3E", "#7FC8E8"],
      tagline: "Sydney to Brisbane along the coast", km: 950, nights: 5, season: "All year", road: "Sealed",
      stops: [P("Sydney", -33.87, 151.21), P("Port Macquarie", -31.43, 152.91), P("Coffs Harbour", -30.3, 153.11), P("Byron Bay", -28.64, 153.61), P("Gold Coast", -28.0, 153.43), P("Brisbane", -27.47, 153.03)],
      highlights: ["Koala Hospital at Port Macquarie", "The Big Banana", "Cape Byron Lighthouse walk", "Surfers Paradise"],
      tips: "Coastal campgrounds fill up in school holidays. Plenty of rest areas on the Pacific Motorway.",
    },
    {
      id: "outbackqld", name: "Outback Queensland", emoji: "🦕", art: ["#A9521C", "#F5C518"],
      tagline: "Dinosaurs, drovers and big skies", km: 1900, nights: 7, season: "April to September", road: "Sealed",
      stops: [P("Brisbane", -27.47, 153.03), P("Roma", -26.57, 148.79), P("Longreach", -23.44, 144.25), P("Winton", -22.39, 143.04), P("Hughenden", -20.84, 144.2), P("Townsville", -19.26, 146.82)],
      highlights: ["Stockman's Hall of Fame in Longreach", "Australian Age of Dinosaurs near Winton", "Porcupine Gorge near Hughenden", "Outback pubs and stargazing"],
      tips: "Free camps are common in outback towns, often with a small donation. Watch for roos at dusk.",
    },
    {
      id: "coralcoast", name: "Coral Coast and Karijini", emoji: "🐠", art: ["#0E7C86", "#E9A35F"],
      tagline: "Perth to Broome via Ningaloo Reef and Karijini gorges", km: 3300, nights: 12, season: "April to October", road: "Sealed (Karijini roads partly gravel)",
      stops: [P("Perth", -31.95, 115.86), P("Cervantes", -30.5, 115.07), P("Kalbarri", -27.71, 114.16), P("Denham", -25.93, 113.53), P("Coral Bay", -23.14, 113.77), P("Exmouth", -21.93, 114.13), P("Tom Price", -22.69, 117.79), P("Broome", -17.96, 122.24)],
      highlights: ["Pinnacles Desert", "Kalbarri Skywalk", "Dolphins at Monkey Mia", "Swimming with whale sharks at Ningaloo", "Karijini's gorges"],
      tips: "Long distances between towns up north. National park campgrounds at Cape Range and Karijini book out early.",
    },
  ];
})();
