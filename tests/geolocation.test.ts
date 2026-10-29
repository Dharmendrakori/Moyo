/// <reference types="vitest/globals" />
import { normalizeGeocodingAddress } from '../src/components/customer/useBrowserGeolocation';

describe('normalizeGeocodingAddress - locality (area) priority', () => {
  it('neighbourhood takes priority over suburb', () => {
    const addr = { neighbourhood: 'Sector 15', suburb: 'Suburb X', city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Sector 15');
  });

  it('suburb is selected when neighbourhood is absent', () => {
    const addr = { suburb: 'Suburb X', city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Suburb X');
  });

  it('quarter is selected when neighbourhood and suburb are absent', () => {
    const addr = { quarter: 'Old City', city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Old City');
  });

  it('residential is selected after quarter', () => {
    const addr = { residential: 'Green Park', city: 'Delhi' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Green Park');
  });

  it('city_district is selected after residential', () => {
    const addr = { city_district: 'South Delhi', city: 'Delhi' };
    expect(normalizeGeocodingAddress(addr).area).toBe('South Delhi');
  });

  it('borough is selected after city_district', () => {
    const addr = { borough: 'Manhattan', city: 'New York' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Manhattan');
  });

  it('hamlet is selected after borough', () => {
    const addr = { hamlet: 'Little Village', city: 'Anytown' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Little Village');
  });

  it('village is selected after hamlet', () => {
    const addr = { village: 'Remote Village', city: 'Anytown' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Remote Village');
  });

  it('town is selected after village', () => {
    const addr = { town: 'Small Town', city: 'Anytown' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Small Town');
  });

  it('municipality is selected after town', () => {
    const addr = { municipality: 'Muni Area', city: 'Anytown' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Muni Area');
  });

  it('skips a candidate that duplicates City in favour of the next valid one', () => {
    const addr = { neighbourhood: 'Bhopal', suburb: 'Sector 15', city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Sector 15');
  });

  it('skips a candidate that duplicates State in favour of the next valid one', () => {
    const addr = { suburb: 'Uttar Pradesh', quarter: 'Civil Lines', city: 'Lucknow', state: 'Uttar Pradesh' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Civil Lines');
  });

  it('case-insensitive duplicate check against City', () => {
    const addr = { neighbourhood: 'Bhopal', suburb: 'Sector 15', city: 'BHOPAL' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Sector 15');
  });

  it('case-insensitive duplicate check against State', () => {
    const addr = { neighbourhood: 'Uttar Pradesh', suburb: 'Sector 15', city: 'Lucknow', state: 'UTTAR PRADESH' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Sector 15');
  });

  it('ignores whitespace-only values', () => {
    const addr = { neighbourhood: '   ', suburb: 'Sector 15', city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Sector 15');
  });

  it('ignores undefined/empty values and produces empty string', () => {
    const addr = { street: 'Some Road', city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).area).toBe('');
  });

  it('produces empty string when no locality keys exist', () => {
    const addr = { city: 'Bhopal', state: 'MP', postcode: '462001' };
    expect(normalizeGeocodingAddress(addr).area).toBe('');
  });

  it('returns the candidate value trimmed', () => {
    const addr = { suburb: '  Sector 15  ', city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Sector 15');
  });
});

describe('normalizeGeocodingAddress - City/State/PIN behavior (unchanged)', () => {
  it('selects city from addr.city', () => {
    expect(normalizeGeocodingAddress({ city: 'Bhopal', state: 'MP', postcode: '462001' }).city).toBe('Bhopal');
  });

  it('falls back to town for city', () => {
    expect(normalizeGeocodingAddress({ town: 'Small Town' }).city).toBe('Small Town');
  });

  it('falls back to municipality for city', () => {
    expect(normalizeGeocodingAddress({ municipality: 'Civic Center' }).city).toBe('Civic Center');
  });

  it('falls back to city_district for city', () => {
    expect(normalizeGeocodingAddress({ city_district: 'District Area' }).city).toBe('District Area');
  });

  it('preserves state', () => {
    expect(normalizeGeocodingAddress({ state: 'Madhya Pradesh' }).state).toBe('Madhya Pradesh');
  });

  it('preserves pincode', () => {
    expect(normalizeGeocodingAddress({ postcode: '462001' }).pincode).toBe('462001');
  });

  it('returns empty city/state/pincode when absent', () => {
    const result = normalizeGeocodingAddress({ road: 'Main St' });
    expect(result.city).toBe('');
    expect(result.state).toBe('');
    expect(result.pincode).toBe('');
  });
});

describe('normalizeGeocodingAddress - street (line1) normalization', () => {
  it('combines house_number and road', () => {
    const addr = { house_number: '123', road: 'Main Street' };
    expect(normalizeGeocodingAddress(addr).line1).toBe('123 Main Street');
  });

  it('uses road alone when no house number', () => {
    const addr = { road: 'Main Street' };
    expect(normalizeGeocodingAddress(addr).line1).toBe('Main Street');
  });

  it('falls back to residential road type', () => {
    const addr = { residential: 'Green Avenue' };
    expect(normalizeGeocodingAddress(addr).line1).toBe('Green Avenue');
  });

  it('falls back to pedestrian road type', () => {
    const addr = { pedestrian: 'Market Lane' };
    expect(normalizeGeocodingAddress(addr).line1).toBe('Market Lane');
  });

  it('falls back to service road type', () => {
    const addr = { service: 'Service Road' };
    expect(normalizeGeocodingAddress(addr).line1).toBe('Service Road');
  });

  it('falls back to path road type', () => {
    const addr = { path: 'Footpath' };
    expect(normalizeGeocodingAddress(addr).line1).toBe('Footpath');
  });

  it('produces empty line1 when no street data', () => {
    const addr = { city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).line1).toBe('');
  });
});

describe('normalizeGeocodingAddress - landmark', () => {
  it('prefers amenity for landmark', () => {
    const addr = { amenity: 'City Hospital', tourism: 'Some Attraction' };
    expect(normalizeGeocodingAddress(addr).landmark).toBe('City Hospital');
  });

  it('falls back to tourism for landmark', () => {
    const addr = { tourism: 'Heritage Site' };
    expect(normalizeGeocodingAddress(addr).landmark).toBe('Heritage Site');
  });

  it('falls back to historic for landmark', () => {
    const addr = { historic: 'Old Fort' };
    expect(normalizeGeocodingAddress(addr).landmark).toBe('Old Fort');
  });

  it('is undefined when no landmark keys', () => {
    const addr = { city: 'Bhopal' };
    expect(normalizeGeocodingAddress(addr).landmark).toBeUndefined();
  });
});

describe('normalizeGeocodingAddress - missing street does not block area', () => {
  it('populates area even when line1 is empty', () => {
    const addr = { suburb: 'Sector 15', city: 'Bhopal' };
    const result = normalizeGeocodingAddress(addr);
    expect(result.line1).toBe('');
    expect(result.area).toBe('Sector 15');
    expect(result.city).toBe('Bhopal');
  });
});

describe('normalizeGeocodingAddress - real Nominatim response shapes', () => {
  it('populates county as area when city_district duplicates city (Sehore response shape)', () => {
    // Mirrors the actual Nominatim response for lat=23.209129, lon=77.086742
    const addr = {
      city_district: 'Sehore',
      city: 'Sehore',
      county: 'Sehore Nagar Tahsil',
      state_district: 'Sehore',
      state: 'Madhya Pradesh',
      postcode: '466002',
    };
    const result = normalizeGeocodingAddress(addr);
    expect(result.city).toBe('Sehore');
    expect(result.state).toBe('Madhya Pradesh');
    expect(result.pincode).toBe('466002');
    // city_district "Sehore" duplicates city "Sehore" → skipped
    // county "Sehore Nagar Tahsil" is distinct → used as area
    expect(result.area).toBe('Sehore Nagar Tahsil');
    // No road data → address line remains empty
    expect(result.line1).toBe('');
    // No amenity/tourism/historic → landmark undefined
    expect(result.landmark).toBeUndefined();
  });

  it('uses county as area when no more specific locality exists and county is distinct', () => {
    const addr = { county: 'South Delhi', city: 'Delhi', state: 'Delhi' };
    expect(normalizeGeocodingAddress(addr).area).toBe('South Delhi');
  });

  it('skips county when it duplicates city', () => {
    const addr = { city_district: 'Bhopal', county: 'Bhopal', city: 'Bhopal', suburb: 'Sector 15' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Sector 15');
  });

  it('populates all fields from a complete road + neighbourhood response', () => {
    const addr = {
      house_number: '123',
      road: 'Main Street',
      neighbourhood: 'Sector 15',
      city: 'Bhopal',
      state: 'Madhya Pradesh',
      postcode: '462001',
      amenity: 'City Hospital',
    };
    const result = normalizeGeocodingAddress(addr);
    expect(result.line1).toBe('123 Main Street');
    expect(result.area).toBe('Sector 15');
    expect(result.city).toBe('Bhopal');
    expect(result.state).toBe('Madhya Pradesh');
    expect(result.pincode).toBe('462001');
    expect(result.landmark).toBe('City Hospital');
  });

  it('uses residential as area when city_district duplicates city', () => {
    const addr = { city_district: 'Delhi', residential: 'Green Park', city: 'Delhi' };
    expect(normalizeGeocodingAddress(addr).area).toBe('Green Park');
  });

  it('does not fabricate address line from display_name or coordinates', () => {
    const addr = { city: 'Sehore', state: 'Madhya Pradesh', postcode: '466002' };
    const result = normalizeGeocodingAddress(addr);
    expect(result.line1).toBe('');
    expect(result.area).toBe('');
  });
});