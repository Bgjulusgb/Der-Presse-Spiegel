'use strict';

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function detectEvents(article, entities = []) {
  const events = [];
  const text = normalize(`${article.title || ''} ${article.fullText || ''}`);

  // Premiere detection
  if (text.includes('premiere')) {
    const productionMatches = entities.filter((e) => e.type === 'production');
    if (productionMatches.length > 0) {
      events.push({
        type: 'premiere',
        production: productionMatches[0].value,
        confidence: productionMatches[0].confidence,
        date: article.published_date,
      });
    }
  }

  // Casting/performer detection
  if (text.includes('rollenverga') || text.includes('casting') || text.includes('besetzt')) {
    const personMatches = entities.filter((e) => e.type === 'person');
    if (personMatches.length > 0) {
      events.push({
        type: 'casting',
        person: personMatches[0].value,
        confidence: 0.7,
        date: article.published_date,
      });
    }
  }

  // Festival/tour detection
  if (text.includes('festival') || text.includes('tournee') || text.includes('gastspiel')) {
    events.push({
      type: 'festival_or_tour',
      confidence: 0.6,
      date: article.published_date,
    });
  }

  // Anniversary/milestone detection
  if (
    text.includes('jubilae') ||
    text.includes('25. spielzeit') ||
    text.includes('10. spielzeit') ||
    text.includes('premiere')
  ) {
    events.push({
      type: 'milestone',
      confidence: 0.5,
      date: article.published_date,
    });
  }

  return events;
}

function groupEventsByType(articles) {
  const eventGroups = {};

  for (const article of articles) {
    const events = detectEvents(article);
    for (const event of events) {
      if (!eventGroups[event.type]) eventGroups[event.type] = [];
      eventGroups[event.type].push({
        ...event,
        articleId: article.id,
        articleTitle: article.title,
      });
    }
  }

  return eventGroups;
}

function getEventTimeline(articles) {
  const timeline = [];

  const eventGroups = groupEventsByType(articles);
  for (const [eventType, events] of Object.entries(eventGroups)) {
    for (const event of events) {
      timeline.push({
        date: event.date,
        type: eventType,
        details: event,
        articleId: event.articleId,
      });
    }
  }

  return timeline.sort((a, b) => new Date(b.date) - new Date(a.date));
}

module.exports = {
  detectEvents,
  groupEventsByType,
  getEventTimeline,
};
