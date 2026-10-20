/* Official road condition and fire warning sites by state, and the live warning feeds the app reads. */
window.CF_ROAD = {
  roads: {
    QLD: ["QLDTraffic", "https://qldtraffic.qld.gov.au/"],
    NSW: ["Live Traffic NSW", "https://www.livetraffic.com/"],
    VIC: ["VicTraffic", "https://traffic.vicroads.vic.gov.au/"],
    SA: ["Traffic SA", "https://traffic.sa.gov.au/"],
    WA: ["Main Roads WA travel map", "https://travelmap.mainroads.wa.gov.au/"],
    NT: ["NT Road Report", "https://roadreport.nt.gov.au/"],
    TAS: ["Tasmania road closures", "https://www.transport.tas.gov.au/roadsafety/roadworks_and_road_closures"],
  },
  fires: {
    QLD: ["QFD bushfire warnings", "https://www.qfes.qld.gov.au/Current-Incidents"],
    NSW: ["NSW RFS Fires Near Me", "https://www.rfs.nsw.gov.au/fire-information/fires-near-me"],
    VIC: ["VicEmergency", "https://emergency.vic.gov.au/respond/"],
    SA: ["CFS warnings", "https://www.cfs.sa.gov.au/warnings-restrictions/"],
    WA: ["Emergency WA", "https://www.emergency.wa.gov.au/"],
    NT: ["SecureNT", "https://securent.nt.gov.au/"],
    TAS: ["TasALERT", "https://www.tasalert.com/"],
  },
  feeds: {
    NSW: "https://www.rfs.nsw.gov.au/feeds/majorIncidents.json",
    VIC: "https://emergency.vic.gov.au/public/events-geojson.json",
    QLD: "https://publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com/content/Feeds/BushfireCurrentIncidents/bushfireAlert.json",
  },
};
