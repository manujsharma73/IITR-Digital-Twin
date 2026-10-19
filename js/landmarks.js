/*
 * Campus landmarks. Coordinates are OSM building centroids, taken from an Overpass query
 * of the IIT Roorkee bounding box on 2026-10-19.
 * Data © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright
 * "levels" is the OSM building:levels tag where one exists. It is not verified.
 * cat: academic | facility | hostel | sports
 */
window.IITR_LANDMARKS = [
  // Academic departments
  { name: "Civil Engineering Department", lat: 29.862609, lon: 77.8985363, cat: "academic", levels: 4 },
  { name: "Mechanical Engineering Department", lat: 29.8623686, lon: 77.8975599, cat: "academic" },
  { name: "Electrical Engineering Department", lat: 29.8636736, lon: 77.8973239, cat: "academic" },
  { name: "Computer Science & Electronics", lat: 29.8635115, lon: 77.8959129, cat: "academic" },
  { name: "Water Resources Development & Management", lat: 29.8635934, lon: 77.8983078, cat: "academic" },
  { name: "Earth Sciences Department", lat: 29.8635849, lon: 77.8992553, cat: "academic" },
  { name: "Geomatics Engineering", lat: 29.8624825, lon: 77.9001293, cat: "academic" },
  { name: "Earthquake Engineering Department", lat: 29.8665104, lon: 77.9006856, cat: "academic" },
  { name: "Chemical Engineering Department", lat: 29.8671572, lon: 77.8932387, cat: "academic" },
  { name: "Production & Industrial Engineering", lat: 29.8637473, lon: 77.8934112, cat: "academic" },
  { name: "Biosciences & Bioengineering", lat: 29.8622551, lon: 77.8915318, cat: "academic" },
  { name: "Department of Physics", lat: 29.8622978, lon: 77.8961356, cat: "academic" },
  { name: "Chemistry Department", lat: 29.8626932, lon: 77.8958061, cat: "academic" },
  { name: "Mathematics & Humanities", lat: 29.8618266, lon: 77.8962281, cat: "academic", levels: 8 },
  { name: "Department of Management Studies", lat: 29.8647451, lon: 77.8946129, cat: "academic" },
  { name: "Intl. Centre of Excellence for Dams", lat: 29.8615491, lon: 77.8976058, cat: "academic" },

  // Facilities
  { name: "Mahatma Gandhi Central Library", lat: 29.8653109, lon: 77.89477, cat: "facility" },
  { name: "New Lecture Hall Complex", lat: 29.8648187, lon: 77.8939002, cat: "facility", levels: 5 },
  { name: "Convocation Hall", lat: 29.8681758, lon: 77.890952, cat: "facility" },
  { name: "OP Jain Auditorium", lat: 29.8631831, lon: 77.8988823, cat: "facility" },
  { name: "Student Activity Center", lat: 29.8665158, lon: 77.8997314, cat: "facility", levels: 4 },
  { name: "International Relations", lat: 29.8637445, lon: 77.8946581, cat: "facility", levels: 1 },
  { name: "Seismological Observatory", lat: 29.8662902, lon: 77.9011346, cat: "facility" },

  // Hostels and residences
  { name: "Rajendra Bhawan", lat: 29.87101, lon: 77.8940761, cat: "hostel", levels: 2 },
  { name: "Cautley Bhawan", lat: 29.8705516, lon: 77.8968407, cat: "hostel" },
  { name: "Ganga Bhawan", lat: 29.8716846, lon: 77.8943674, cat: "hostel" },
  { name: "Khosla International House", lat: 29.8615634, lon: 77.8986526, cat: "hostel", levels: 3 },
  { name: "Trainee Officers Hostel", lat: 29.8680501, lon: 77.9006966, cat: "hostel", levels: 4 },
  { name: "Jawahar Bhawan Mess", lat: 29.8634641, lon: 77.9005729, cat: "hostel", levels: 2 },

  // Sports
  { name: "Lal Bahadur Shastri Stadium", lat: 29.8671163, lon: 77.8953063, cat: "sports" },
  { name: "Major Dhyan Chand Stadium", lat: 29.8677614, lon: 77.8988284, cat: "sports" },
  { name: "Tennis Grounds", lat: 29.8626452, lon: 77.8946917, cat: "sports" },
  { name: "ABN Ground", lat: 29.8691929, lon: 77.8962255, cat: "sports" },
];

// Stops for the guided tour, by name (must match entries above).
window.IITR_TOUR = [
  "Mahatma Gandhi Central Library",
  "Civil Engineering Department",
  "New Lecture Hall Complex",
  "Lal Bahadur Shastri Stadium",
  "Convocation Hall",
  "Rajendra Bhawan",
  "Student Activity Center",
];
