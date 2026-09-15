export function getTourApiServiceKey() {
  return process.env.TOUR_API_SERVICE_KEY?.trim() ?? "";
}

export function isTourApiConfigured() {
  return getTourApiServiceKey().length > 0;
}
