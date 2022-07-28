function isLink(linkable) {
  return linkable.and?.[0]?.isLink
}

module.exports = {
  isLink: isLink,
  itselfOrTraverseLink: (linkable) => {
    if (isLink(linkable)) {
      return linkable.and[0].linkTarget
    } else {
      return linkable
    }
  },
  findCustomDomainProperty: (element, propertyName) => {
    return element.customDomainProperties.find(d => d.name.value() == propertyName)
  },
  toSnakeCase: (str) => {
    return str.replace(
      /[A-Z]+/g,
      (match, offset) => (offset > 0 ? "_" : "") + match.toLowerCase()
    )
  },
  toCamelCase: (str) => {
    return str.replace(
      /(^|_)([a-z])/g,
      (_m, _p1, p2) => p2.toUpperCase()
    )
  }
}
