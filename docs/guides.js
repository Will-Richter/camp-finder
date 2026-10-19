/* Destination guides. Each fact comes from the linked official or operator page.
 * `checked` is the date the details were last checked; prices and alerts change, so the app always links the source.
 * To add a guide, copy the K'gari block. `area` is a circle (lat, lon, km) used to spot trips and map views that reach it.
 */
window.CF_GUIDES = [
  {
    id: "kgari",
    name: "K'gari (Fraser Island)",
    aliases: ["kgari", "k'gari", "fraser island", "fraser", "great sandy national park"],
    area: { lat: -25.25, lon: 153.13, km: 70 },
    centre: [-25.25, 153.13],
    checked: "2026-10-19",
    summary: "4WD only. You need a vehicle access permit, a camping permit for national park camps, and a barge or ferry booking for the River Heads crossing.",
    sections: [
      {
        title: "Getting there",
        items: [
          {
            name: "Manta Ray barge: Inskip Point to Hook Point",
            text: "10-minute crossing, runs daily from about 6am to 5pm. No booking needed: buy tickets online, on board or at the office. Arrive at least 15 minutes before the last barges.",
            phone: "07 5486 3935",
            link: "https://mantarayfraserislandbarge.com.au/",
            linkText: "Manta Ray barges",
            book: "ferry",
          },
          {
            name: "SeaLink vehicle ferry: River Heads to Kingfisher Bay",
            text: "About 45 minutes, several return services daily. Book ahead online or at the River Heads office (54 Ariadne Street, open 8am to 4pm). Check in about 20 minutes before departure and reconfirm times, as they can change.",
            phone: "1800 372 737",
            link: "https://www.sealink.com.au/kgari-fraser-island/",
            linkText: "Book SeaLink",
            book: "ferry",
          },
        ],
      },
      {
        title: "Permits",
        items: [
          {
            name: "Vehicle access permit (required)",
            text: "Every vehicle driving on K'gari needs one, bought before you go. $61.80 for 1 month or less, $311.00 for up to a year. A combined K'gari and Cooloola permit is 20% cheaper. You don't need to display it (number plate cameras are used) but keep a copy on your phone. Driving without one risks a $518 fine.",
            phone: "13 74 68",
            link: "https://book.parks.qld.gov.au/vehicle-permits",
            linkText: "Buy vehicle permit",
            book: "permit",
          },
          {
            name: "Camping permit (required for national park camps)",
            text: "Every camping area has a capacity limit and can book out. Bookings open 12 months ahead. The camping permit is separate from the vehicle permit.",
            link: "https://qld.gov.au/camping",
            linkText: "Book camping",
            book: "camping",
          },
        ],
      },
      {
        title: "Where to camp",
        items: [
          {
            name: "Dingo-fenced camping areas",
            text: "Recommended for families with children 14 and under: Central Station, Cornwells, Dundubara, Eli, Lake Boomanjin, One Tree, Wathumba, Waddy Point Top and Wongai.",
            link: "https://parks.qld.gov.au/parks/kgari-fraser/camping/campgrounds-summary",
            linkText: "All camping areas",
          },
          {
            name: "Eastern beach camping zones",
            text: "Nine beach zones run from Dilli Village north to Sandy Cape. Keep your camp compact and off the access tracks.",
            link: "https://parks.qld.gov.au/parks/kgari-fraser/camping/campgrounds-summary",
            linkText: "Camping zones",
          },
        ],
      },
      {
        title: "Stay and supplies",
        items: [
          {
            name: "Kingfisher Bay Resort",
            text: "Resort on the western side where the River Heads ferry arrives. Has fuel and some groceries.",
            link: "https://www.kingfisherbay.com/",
            linkText: "Kingfisher Bay Resort",
            book: "accommodation",
          },
          {
            name: "Fuel and groceries",
            text: "Fuel at Eurong Beach, Kingfisher Bay Resort, Happy Valley and Orchid Beach. Some groceries at the same places. There's no LPG on the island. Bring your own food and drinking water.",
            link: "https://edit.usc.edu.au/k-gari-app/need-to-know/shops-fuel-water-other-supplies",
            linkText: "Supplies guide",
          },
        ],
      },
      {
        title: "Before you go",
        items: [
          {
            name: "Conditions report",
            text: "Queensland Parks puts critical safety information, closures and beach conditions in this report. Check it before you go.",
            link: "https://parks.qld.gov.au/__data/assets/pdf_file/0022/160348/kgari-conditions-report.pdf",
            linkText: "Open conditions report",
          },
          {
            name: "Driving on K'gari",
            text: "4WD only. Speed limits, tide times and safe beach driving are covered on the parks page.",
            link: "https://parks.qld.gov.au/parks/kgari-fraser/visiting-safely/getting-there-and-getting-around",
            linkText: "Getting there and around",
          },
          {
            name: "Be dingo-safe",
            text: "Wongari (dingoes) live across the island. Stay close to children, never feed them, and lock food away.",
            link: "https://parks.qld.gov.au/parks/kgari-fraser/about/wongari-dingoes/dingo-safe",
            linkText: "Dingo safety",
          },
        ],
      },
    ],
    checklist: [
      "Vehicle access permit bought",
      "Camping permit booked",
      "Barge or ferry sorted",
      "Checked the conditions report",
      "Tide times for your drive",
      "Recovery gear: snatch strap, shovel, tyre deflator, compressor",
      "Enough drinking water and food",
      "Gas bottles filled (no LPG on the island)",
    ],
    sources: [
      ["Queensland Parks: vehicle access permits", "https://parks.qld.gov.au/management/managed-areas/recreation/vehicle-permits"],
      ["Queensland Parks: K'gari camping zones", "https://parks.qld.gov.au/parks/kgari-fraser/camping/campgrounds-summary"],
      ["Queensland Parks: K'gari", "https://parks.qld.gov.au/parks/kgari-fraser"],
      ["SeaLink K'gari ferry", "https://www.sealink.com.au/kgari-fraser-island/ferry-information/sealink-kgari-fraser-island-ferries/"],
      ["Manta Ray barges", "https://mantarayfraserislandbarge.com.au/about/"],
    ],
  },
];
