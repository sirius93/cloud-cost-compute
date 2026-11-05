import assert from 'node:assert/strict'
import { importTerraform, isTerraformFile, EXAMPLE_TF } from './terraform.js'
import { sizeOf, nodeCost, totals } from './cost.js'

const tf = (text, name = 'main.tf') => importTerraform([{ name, text }])
const find = (r, key) => r.nodes.find(n => n.data.source === key)?.data
const wires = r => r.edges.map(e => `${e.source.split('|').pop()} -> ${e.target.split('|').pop()}`).sort()

// The example: services, sizes, quantities and wires
const ex = tf(EXAMPLE_TF)
assert.equal(ex.cloud, 'aws')
assert.equal(sizeOf('aws', find(ex, 'aws_autoscaling_group.web'))[0], 'm5.large') // var default, via launch template
assert.equal(find(ex, 'aws_autoscaling_group.web').qty, 3)
assert.equal(find(ex, 'aws_db_instance.main').qty, 2)                             // Multi-AZ
assert.equal(find(ex, 'aws_lambda_function.worker').memGiB, 1)
assert.deepEqual(wires(ex), [
  'aws_autoscaling_group.web -> aws_db_instance.main', // through the launch template
  'aws_lambda_function.worker -> aws_s3_bucket.assets',
  'aws_lambda_function.worker -> aws_sqs_queue.jobs',  // through the event source mapping
  'aws_lb.web -> aws_autoscaling_group.web',           // through listener and target group
  'internet -> aws_lb.web',                            // inferred
])
assert.deepEqual(ex.report.warnings, [])
assert.deepEqual(ex.report.notPriced, [])
assert.equal(ex.report.placeholders, 3) // S3, SQS, Lambda
assert.ok(totals(ex.cloud, ex.nodes, ex.edges).total > 0)
assert.equal(new Set(ex.nodes.map(n => `${n.position.x},${n.position.y}`)).size, ex.nodes.length) // no overlaps

// Comments, strings and heredocs can't fool the scanner
const tricky = tf(`
# resource "aws_instance" "commented" { instance_type = "t3.micro" }
/* resource "aws_instance" "blocked" {} */
resource "aws_instance" "a" {
  instance_type = "t3.medium" // don't read this "quote"
  tags = { Name = "has } brace \${upper("x}")}" }
  user_data = <<-EOT
    unbalanced { brace and "quote
    instance_type = "c5.2xlarge"
  EOT
}
resource "aws_instance" "b" { instance_type = "t3.micro" }
`)
assert.deepEqual(tricky.nodes.map(n => n.data.source), ['aws_instance.a', 'aws_instance.b'])
assert.equal(sizeOf('aws', find(tricky, 'aws_instance.a'))[0], 't3.medium')
assert.deepEqual(tricky.report.warnings, [])

// Unknown sizes are reported, never silently wrong
const sizes = tf(`
resource "aws_instance" "near" { instance_type = "m6i.large" }
resource "aws_instance" "unknown" { instance_type = "z1d.12xlarge" }
resource "aws_instance" "expr" {
  instance_type = var.big ? "m5.large" : "t3.micro"
}
`)
assert.equal(sizeOf('aws', find(sizes, 'aws_instance.near'))[0], 'm5.large')
assert.equal(sizes.report.warnings.length, 3)
assert.match(sizes.report.warnings.join(), /m6i\.large.*priced as m5\.large/)
assert.match(sizes.report.warnings.join(), /z1d\.12xlarge/)
assert.match(sizes.report.warnings.join(), /aws_instance\.expr: couldn't read/)

// count, for_each, tfvars and locals
const counts = importTerraform([
  { name: 'main.tf', text: `
    variable "n" { default = 1 }
    variable "size" {}
    locals { kind = "t3.medium" }
    resource "aws_instance" "many" {
      count = var.n
      instance_type = var.size
    }
    resource "aws_instance" "local" { instance_type = local.kind }
    resource "aws_instance" "off" {
      count = 0
      instance_type = "t3.micro"
    }
    resource "aws_ebs_volume" "disks" {
      count = 2
      size = 50
    }
    resource "aws_s3_bucket" "each" { for_each = var.buckets }
    resource "aws_vpc" "free" {}
    resource "aws_route53_zone" "unmapped" {}
    module "app" { source = "./app" }
  ` },
  { name: 'terraform.tfvars', text: 'n = 4\nsize = "m5.xlarge"\n' },
])
assert.equal(find(counts, 'aws_instance.many').qty, 4)
assert.equal(sizeOf('aws', find(counts, 'aws_instance.many'))[0], 'm5.xlarge')
assert.equal(sizeOf('aws', find(counts, 'aws_instance.local'))[0], 't3.medium')
assert.equal(find(counts, 'aws_instance.off'), undefined)
assert.equal(find(counts, 'aws_ebs_volume.disks').amount, 100)
assert.deepEqual(counts.report.notPriced, ['aws_route53_zone.unmapped'])
assert.match(counts.report.warnings.join(), /for_each/)
assert.match(counts.report.warnings.join(), /Modules aren't expanded: app/)

// Shared infrastructure must not wire services together
const shared = tf(`
resource "aws_vpc" "v" {}
resource "aws_instance" "a" {
  instance_type = "t3.micro"
  subnet_id = aws_subnet.s.id
}
resource "aws_db_instance" "b" {
  instance_class = "db.t3.micro"
  vpc_security_group_ids = [aws_subnet.s.id]
}
resource "aws_subnet" "s" { vpc_id = aws_vpc.v.id }
`)
assert.deepEqual(shared.edges, [])

// Internal load balancers get no Internet node; a CDN in front takes the entry point
assert.equal(find(tf('resource "aws_lb" "x" {\n internal = true\n}'), 'aws_lb.x').source, 'aws_lb.x')
assert.ok(!tf('resource "aws_lb" "x" {\n internal = true\n}').report.inferredInternet)
const cdn = tf(`
resource "aws_lb" "l" {}
resource "aws_cloudfront_distribution" "c" {
  origin { domain_name = aws_lb.l.dns_name }
}`)
assert.deepEqual(wires(cdn), ['aws_cloudfront_distribution.c -> aws_lb.l', 'internet -> aws_cloudfront_distribution.c'])

// Azure and Google Cloud, including inline worker pools and unit conversion
const azure = tf(`
resource "azurerm_linux_virtual_machine" "vm" { size = "Standard_B2s" }
resource "azurerm_postgresql_flexible_server" "db" { sku_name = "GP_Standard_D2s_v3" }
resource "azurerm_redis_cache" "r" {
  family = "C"
  capacity = 1
  sku_name = "Standard"
}
resource "azurerm_kubernetes_cluster" "k" {
  default_node_pool {
    vm_size = "Standard_D4s_v5"
    node_count = 3
  }
}`)
assert.equal(azure.cloud, 'azure')
assert.deepEqual(azure.report.warnings, [])
const pool = azure.nodes.find(n => n.id.endsWith('#pool')).data
assert.equal(sizeOf('azure', pool)[0], 'D4s v5')
assert.equal(pool.qty, 3)
assert.equal(nodeCost('azure', pool), 0.192 * 3 * 730)
assert.equal(azure.edges.length, 1)

const gcp = tf(`
resource "google_compute_instance" "i" { machine_type = "e2-standard-4" }
resource "google_sql_database_instance" "s" {
  settings { tier = "db-f1-micro" }
}
resource "google_redis_instance" "r" {
  tier = "STANDARD_HA"
  memory_size_gb = 5
}
resource "google_cloud_run_v2_service" "run" {
  template {
    max_instance_request_concurrency = 40
    containers {
      resources {
        limits = { cpu = "2000m", memory = "512Mi" }
      }
    }
  }
}
resource "google_compute_backend_service" "plain" {}
resource "google_compute_backend_bucket" "cached" { enable_cdn = true }
`)
assert.equal(gcp.cloud, 'gcp')
assert.equal(sizeOf('gcp', find(gcp, 'google_compute_instance.i'))[0], 'n2-standard-4')
assert.equal(sizeOf('gcp', find(gcp, 'google_sql_database_instance.s'))[0], 'db-f1-micro')
assert.equal(sizeOf('gcp', find(gcp, 'google_redis_instance.r'))[0], 'Standard 5 GB')
const run = find(gcp, 'google_cloud_run_v2_service.run')
assert.deepEqual([run.vcpu, run.memGiB, run.concurrency], [2, 0.5, 40])
assert.equal(find(gcp, 'google_compute_backend_service.plain'), undefined)
assert.equal(find(gcp, 'google_compute_backend_bucket.cached').kind, 'cdn')

// Several folders stay separate: same names don't collide, variables don't leak
const multi = importTerraform([
  { name: 'dev/main.tf', text: 'variable "t" { default = "t3.micro" }\nresource "aws_instance" "web" { instance_type = var.t }' },
  { name: 'prod/main.tf', text: 'variable "t" { default = "m5.large" }\nresource "aws_instance" "web" { instance_type = var.t }' },
])
assert.deepEqual(multi.nodes.map(n => n.data.label).sort(), ['dev/web', 'prod/web'])
assert.equal(sizeOf('aws', multi.nodes.find(n => n.data.label === 'prod/web').data)[0], 'm5.large')

// Bad input is reported, not thrown
assert.match(tf('resource "aws_instance" "a" {').report.warnings[0], /unbalanced/)
assert.equal(tf('not terraform at all').nodes.length, 0)
assert.equal(tf('').nodes.length, 0)
assert.match(tf('{}', 'x.tf.json').report.warnings[0], /JSON/)
assert.ok(tf('resource "aws_instance" "a" { instance_type = "t3.micro" }\r\n').nodes.length === 1) // Windows line endings

assert.ok(isTerraformFile('infra/main.tf') && isTerraformFile('prod.tfvars'))
assert.ok(!isTerraformFile('README.md') && !isTerraformFile('a/.terraform/modules/x/main.tf') && !isTerraformFile('terraform.tfstate'))

console.log('terraform checks passed')
