import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import orderBy from 'lodash.orderby'
import { loadUserInfo } from './users.mjs'

/*
 * Shared header to include in written .mjs files
 */
export const header = `/*
 * This file was auto-generated by the prebuild script
 * Any changes you make to it will be lost on the next (pre)build.
 */
`

/*
 * Strips quptes from the start/end of a string
 */
const stripQuotes = (str) => {
  str = str.trim()
  if (str.slice(0, 1) === '"') str = str.slice(1)
  if (str.slice(-1) === '"') str = str.slice(0, -1)

  return str.trim()
}

/*
 * This is the fast and low-tech way to some frontmatter from all files in a folder
 */
const loadFolderFrontmatter = async (key, site, folder, transform = false, lang = false) => {
  const prefix = site === 'org' ? `${folder}/` : ''
  /*
   * Figure out what directory to spawn the child process in
   */
  const cwd = await path.resolve(process.cwd(), '..', '..', 'markdown', site, folder)
  /*
   * When going through a small number of files in a flat directory (eg. blog posts) a
   * recursive grep through all files is faster.
   * But the biggest task is combing through all the org documentation and for this
   * it's much faster to first run find to limit the number of files to open
   */
  //const cmd = `find . -type f -name "${lang ? lang : '*'}.md" -exec grep "^${key}:" -ism 1 {} +`
  const cmd = lang
    ? `find . -type f -name "${lang ? lang : '*'}.md" -exec grep "^${key}:" -ism 1 {} +`
    : `grep -R "^${key}:" -ism 1 .`
  const grep = exec(cmd, { cwd, maxBuffer: 2048 * 1024 }, (error, stdout, stderr) => {
    if (error) console.error('Exec error:', { cwd, cmd, error, stderr })

    return stdout
  })

  /*
   * Stdout is buffered, so we need to gather all of it
   */
  let stdout = ''
  for await (const data of grep.stdout) stdout += data

  /*
   * Turn all matches into an array
   */
  const matches = stdout.split('\n')

  /*
   * Turns matches into structured data
   */
  const pages = {}
  for (let match of matches) {
    /*
     * Trim some of the irrelevant path info prior to splitting on '.md:{key}:'
     */
    const chunks = match
      .split(`markdown/${site}/${site === 'dev' ? '' : folder + '/'}`)
      .pop()
      .split(`.md:${key}:`)

    if (chunks.length === 2 && chunks[0].length > 1) {
      /*
       * Figure out the language and make sure we have an key for that language
       */
      const lang = chunks[0].slice(-2)
      if (!pages[lang]) pages[lang] = {}

      /*
       * Add page to our object with slug as key and title as value
       */
      let slug = prefix + chunks[0].slice(0, -3).replace('./', '')
      if (slug === prefix) slug = slug.slice(0, -1)
      if (slug !== 'docs/.')
        pages[lang][slug] = transform
          ? transform(stripQuotes(chunks[1]), slug, lang)
          : stripQuotes(chunks[1])
    }
  }

  return pages
}

/*
 * Merges in order key on those slugs that have it set
 */
const mergeOrder = (titles, order, withSlug = false) => {
  const pages = {}
  for (const lang in titles) {
    pages[lang] = {}
    for (const [slug, t] of Object.entries(titles[lang])) {
      pages[lang][slug] = { t }
      if (order.en[slug]) pages[lang][slug].o = order.en[slug]
      if (withSlug) pages[lang][slug].s = slug
    }
  }

  return pages
}

/*
 * Fixes the date format to be yyyymmdd
 */
const formatDate = (date, slug, lang) => {
  date = date.split('-')
  if (date.length === 1) date = date[0].split('.')
  if (date.length === 1) {
    if (date[0].length === 8) return date[0]
    else console.log(`Could not format date ${date} from ${slug} (${lang})`)
  } else {
    if (date[0].length === 4) return date.join('')
    else return date.reverse().join('')
  }
}

/*
 * Loads all new users and adds them to the store
 */
const loadUsers = async (list, store) => {
  // Weed out doubles in list
  for (const user of [...new Set([...list])]) {
    const id = Number(user)
    if (id && typeof store.users[id] === 'undefined') store.users[id] = await loadUserInfo(id)
  }
}

/*
 * Loads all docs files, titles and order
 */
const loadDocs = async (site) => {
  const folder = site === 'org' ? 'docs' : ''
  const titles = await loadFolderFrontmatter('title', site, folder)
  // Order is the same for all languages, so only grab EN files
  const order = await loadFolderFrontmatter('order', site, folder, false, 'en')

  return mergeOrder(titles, order)
}

/*
 * Loads jargon and terms
 */
const loadJargon = async (site, docs) => {
  const folder = site === 'org' ? 'docs' : ''
  const jargon = await loadFolderFrontmatter('jargon', site, folder)
  const terms = await loadFolderFrontmatter('terms', site, folder)

  const data = {}
  for (const lang in jargon) {
    data[lang] = {}
    for (const slug in jargon[lang]) {
      data[lang][docs[lang][slug].t.toLowerCase()] = slug
      if (terms[lang]?.[slug]) {
        for (const term of terms[lang][slug].split(',').map((term) => term.trim())) {
          data[lang][term.toLowerCase()] = slug
        }
      }
    }
  }

  return data
}

/*
 * Loads all blog posts, titles and order
 */
const loadBlog = async (store) => {
  const titles = await loadFolderFrontmatter('title', 'org', 'blog')
  // Order is the same for all languages, so only grab EN files
  const order = await loadFolderFrontmatter('date', 'org', 'blog', formatDate, 'en')
  // Author is the same for all languages, so only grab EN files
  const authors = await loadFolderFrontmatter('author', 'org', 'blog', false, 'en')
  // Load user accounts of authors
  await loadUsers(Object.values(authors.en), store)

  // Merge titles and order for EN
  const merged = {}
  for (const slug in titles.en)
    merged[slug] = {
      t: titles.en[slug],
      o: order.en[slug],
      s: slug,
      a: authors.en[slug],
    }
  // Order based on post data (descending)
  const ordered = orderBy(merged, 'o', 'desc')

  // Apply same order to all languages
  const posts = {}
  const meta = {}

  for (const lang of Object.keys(titles)) {
    posts[lang] = {}
    for (const post of ordered) {
      const sortkey = 9999999999 - post.o
      posts[lang][post.s] = { t: post.t, o: sortkey }
      if (lang === 'en') meta[post.s] = { a: post.a, d: post.o }
    }
  }

  return { posts, meta }
}

/*
 * Loads all showcase posts, titles, designs and order
 */
const loadShowcase = async (store) => {
  const titles = await loadFolderFrontmatter('title', 'org', 'showcase')
  // Order is the same for all languages, so only grab EN files
  const order = await loadFolderFrontmatter('date', 'org', 'showcase', formatDate, 'en')
  // Author is the same for all languages, so only grab EN files
  const authors = await loadFolderFrontmatter('author', 'org', 'showcase', false, 'en')
  // Load user accounts of authors
  await loadUsers(Object.values(authors.en), store)

  // Merge titles and order for EN
  const merged = {}
  for (const slug in titles.en)
    merged[slug] = {
      t: titles.en[slug],
      o: order.en[slug],
      s: slug,
      m: authors.en[slug],
    }
  // Order based on post data (descending)
  const ordered = orderBy(merged, 'o', 'desc')

  // Apply same order to all languages
  const posts = {}
  const meta = {}

  for (const lang of Object.keys(titles)) {
    posts[lang] = {}
    for (const post of ordered) {
      posts[lang][post.s] = { t: post.t }
      if (lang === 'en') meta[post.s] = { m: post.m, d: post.o }
    }
  }

  /*
   * Create list of showcase slugs per design
   */
  const designShowcases = {}
  // Designs is the same for all languages, so only grab EN files
  const designs = await loadFolderFrontmatter('designs', 'org', 'showcase', false, 'en')
  for (const [slug, list] of Object.entries(designs.en)) {
    for (const design of JSON.parse(list)) {
      if (typeof designShowcases[design] === 'undefined') designShowcases[design] = []
      designShowcases[design].push(slug.split('/').pop())
    }
  }

  return { posts, meta, designShowcases }
}

/*
 * Loads all newsletter posts, titles and order
 */
const loadNewsletter = async () => {
  const titles = await loadFolderFrontmatter('title', 'org', 'newsletter')
  // Order is the same for all languages, so only grab EN files
  const order = await loadFolderFrontmatter('edition', 'org', 'newsletter', false, 'en')

  return mergeOrder(titles, order)
}

/*
 * Write out prebuild files
 */
const writeFiles = async (type, site, pages) => {
  let allPaths = ``
  for (const lang in pages) {
    fs.writeFileSync(
      path.resolve('..', site, 'prebuild', `${type}.${lang}.mjs`),
      `${header}export const pages = ${JSON.stringify(pages[lang])}`
    )
    allPaths += `import { pages as ${lang} } from './${type}.${lang}.mjs'` + '\n'
  }
  // Write umbrella file
  fs.writeFileSync(
    path.resolve('..', site, 'prebuild', `${type}.mjs`),
    `${allPaths}${header}

export const pages = { ${Object.keys(pages).join(',')} }`
  )
}

/*
 * Write out a single prebuild file
 */
const writeFile = async (filename, exportname, site, content) => {
  fs.writeFileSync(
    path.resolve('..', site, 'prebuild', `${filename}.mjs`),
    `${header}export const ${exportname} = ${JSON.stringify(content)}`
  )
}

/*
 * Copy all the markdown resources + image assets to the public folder
 */
const copyMdRawFiles = async (site) => {
  const src = await path.resolve(process.cwd(), '..', '..', 'markdown', site)
  const dst = await path.resolve(process.cwd(), '..', site, 'public', 'markdown')

  await new Promise((resolve, reject) => {
    exec(`mkdir -p ${dst}`, { maxBuffer: 2048 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(error)
      resolve(stdout)
    })
  })

  await new Promise((resolve, reject) => {
    exec(`cp -r ${src} ${dst}`, { maxBuffer: 2048 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(error)
      resolve(stdout)
    })
  })
}

/*
 * Main method that does what needs doing for the docs
 */
export const prebuildDocs = async (store) => {
  store.docs = await loadDocs(store.site)
  await writeFiles('docs', store.site, store.docs)

  // Handle jargon
  store.jargon = await loadJargon(store.site, store.docs)
  fs.writeFileSync(
    path.resolve('..', store.site, 'prebuild', `jargon.mjs`),
    `${header}
export const site = "${store.site}"
export const jargon = ${JSON.stringify(store.jargon, null, 2)}`
  )
}

/*
 * Main method that does what needs doing for the blog/showcase/newsletter posts
 */
export const prebuildPosts = async (store) => {
  store.posts = {
    blog: await loadBlog(store),
    showcase: await loadShowcase(store),
    newsletter: { posts: await loadNewsletter(store) },
  }
  await writeFiles('blog', 'org', store.posts.blog.posts)
  await writeFiles('showcase', 'org', store.posts.showcase.posts)
  await writeFiles('newsletter', 'org', store.posts.newsletter)
  await writeFile('blog-meta', 'meta', 'org', store.posts.blog.meta)
  await writeFile('showcase-meta', 'meta', 'org', store.posts.showcase.meta)
  await writeFile('design-examples', 'examples', 'org', store.posts.showcase.designShowcases)
  await writeFile('authors', 'authors', 'org', store.users)
}

/*
 * Main method to collect all the raw resource paths to be served as static resources for client-side rendering
 */
export const prebuildMdRaw = async (store) => {
  await copyMdRawFiles(store.site)
}
